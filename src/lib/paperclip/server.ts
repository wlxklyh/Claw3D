import type { PaperclipAttention, PaperclipIssueContext, PaperclipRun, PaperclipSnapshot } from "./types";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const str = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const nullable = (value: unknown): string | null => typeof value === "string" && value ? value : null;

export class PaperclipConnectionError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export function readPaperclipConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  const rawUrl = env.PAPERCLIP_BASE_URL?.trim() || "http://127.0.0.1:3100";
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new PaperclipConnectionError("PAPERCLIP_BASE_URL 不是有效 URL。", 503); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new PaperclipConnectionError("PAPERCLIP_BASE_URL 必须是没有凭据或路径的 HTTP(S) 服务地址。", 503);
  }
  const companyId = env.PAPERCLIP_COMPANY_ID?.trim();
  if (!companyId) throw new PaperclipConnectionError("尚未配置公司。请在 .env.local 设置 PAPERCLIP_BASE_URL 和 PAPERCLIP_COMPANY_ID，然后重启 Claw3D。", 503);
  return { baseUrl: url.origin, companyId, token: env.PAPERCLIP_API_TOKEN?.trim() };
}

/** Only same-company UI links are accepted from backend content. */
export function paperclipHref(baseUrl: string, prefix: string, path: unknown, fallback: string) {
  const root = `/${encodeURIComponent(prefix)}`;
  try {
    const url = new URL(str(path), baseUrl);
    if (url.origin === baseUrl && (url.pathname === root || url.pathname.startsWith(`${root}/`))) return url.href;
  } catch { /* use a known company route */ }
  return `${baseUrl}${root}/${fallback}`;
}

export function attentionAudience(sourceKind: string, policy: string | null): PaperclipAttention["audience"] {
  if (["approval", "decision", "join_request", "recovery_action"].includes(sourceKind) || policy === "board_only" || policy === "human_only") return "human";
  if (["board_or_agents", "anyone", "not_creator"].includes(policy ?? "")) return "shared";
  if (policy === "addressee" || policy === "agent_only") return "agent";
  return "check";
}

export function reviewAudience(issue: Row, pendingApproval = false): PaperclipAttention["audience"] {
  const state = row(issue.executionState);
  if (state.status === "pending") {
    if (row(state.currentParticipant).type === "user") return "human";
    if (row(state.currentParticipant).type === "agent") return "agent";
  }
  if (issue.assigneeUserId || pendingApproval) return "human";
  return "check";
}

export function blockerAudience(issue: Row): PaperclipAttention["audience"] {
  const owner = row(issue.unblockDescriptor).owner;
  if (owner === "board" || row(owner).userId || issue.assigneeUserId) return "human";
  if (row(owner).agentId) return "agent";
  return "check";
}

/** A terminal blocker can name a different affected parent in relatedIssue. */
export function attentionIssueId(item: Row): string | null {
  const subject = row(item.subject);
  return (subject.kind === "issue" ? nullable(subject.id) : null)
    || nullable(row(item.relatedIssue).id) || nullable(row(subject.metadata).issueId);
}

export async function loadPaperclipSnapshot(fetcher: typeof fetch = fetch): Promise<PaperclipSnapshot> {
  const config = readPaperclipConfig();
  const companyPath = `/companies/${encodeURIComponent(config.companyId)}`;
  const warnings: string[] = [];
  const get = async (path: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`${config.baseUrl}/api${path}`, {
        method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      });
    } catch {
      throw new PaperclipConnectionError(`无法连接 Paperclip（${config.baseUrl}）。请检查服务和连接配置。`);
    }
    if (!response.ok) throw new PaperclipConnectionError(`Paperclip ${path.split("?")[0]} 返回 HTTP ${response.status}。请检查公司和访问权限。`);
    try { return await response.json(); } catch { throw new PaperclipConnectionError("Paperclip 未返回有效 JSON 数据。"); }
  };
  const optional = async (path: string, label: string) => {
    try { return await get(path); } catch (error) {
      warnings.push(`${label}读取失败；此部分不能视为空。${error instanceof Error ? error.message : ""}`);
      return null;
    }
  };
  const company = row(await get(companyPath));
  if (company.id !== config.companyId || !str(company.issuePrefix)) throw new PaperclipConnectionError("Paperclip 返回了不匹配的公司或缺少公司前缀。");
  const prefix = str(company.issuePrefix);
  const href = (path: unknown, fallback: string) => paperclipHref(config.baseUrl, prefix, path, fallback);
  const taskHref = (task: Row) => href(null, `issues/${encodeURIComponent(str(task.identifier) || str(task.id))}`);
  // Cap large companies explicitly; never imply a partial list is the whole company.
  const readTasks = async () => {
    const all: Row[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await get(`${companyPath}/issues?limit=100&offset=${offset}&sortField=updated&sortDir=desc&includeBlockedBy=true`);
      if (!Array.isArray(page)) throw new PaperclipConnectionError("任务列表响应格式不受支持。");
      all.push(...rows(page));
      if (page.length < 100) return all;
    }
    warnings.push("任务现场最多展示最近 1,000 条任务；完整任务请打开 Paperclip。");
    return all;
  };
  const [rawAgents, rawTasks, rawLive, rawRecent, rawAttention, rawArtifacts, rawProjects] = await Promise.all([
    get(`${companyPath}/agents`), readTasks(), optional(`${companyPath}/live-runs?limit=100`, "运行状态"),
    optional(`${companyPath}/heartbeat-runs?summary=true&limit=30`, "运行历史"),
    optional(`${companyPath}/attention?all=true&sort=decide`, "人工与异常待办"),
    optional(`${companyPath}/artifacts?limit=50`, "成果"), optional(`${companyPath}/projects`, "项目"),
  ]);
  if (!Array.isArray(rawAgents)) throw new PaperclipConnectionError("Agent 列表响应格式不受支持。");
  const mapRun = (run: Row): PaperclipRun => ({
    id: str(run.id), agentId: str(run.agentId), issueId: nullable(run.issueId) || nullable(row(run.contextSnapshot).issueId),
    status: str(run.status), startedAt: nullable(run.startedAt), finishedAt: nullable(run.finishedAt),
    lastOutputAt: nullable(run.lastOutputAt), livenessState: nullable(run.livenessState), livenessReason: nullable(run.livenessReason),
    endReason: run.status === "cancelled" && run.error === "Cancelled before issue reassignment" ? "task_handoff" : null,
    href: href(null, `agents/${encodeURIComponent(str(run.agentId))}/runs/${encodeURIComponent(str(run.id))}`),
  });
  const attention = row(rawAttention);
  const approvalIssueIds = new Set(rows(attention.items).filter((item) => item.sourceKind === "approval").map((item) => nullable(row(row(item.subject).metadata).issueId)).filter(Boolean));
  const artifacts = row(rawArtifacts);
  if (rawLive !== null && !Array.isArray(rawLive)) warnings.push("运行状态响应格式不受支持；当前运行状态未知。");
  if (artifacts.nextCursor) warnings.push("成果区域展示最近 50 条；完整成果请打开成果库。");
  if (attention.nextCursor) warnings.push("待办结果未完整返回，请打开 Paperclip 决策台查看全部。");
  const attentionAvailable = rawAttention !== null && Array.isArray(attention.items);
  if (rawAttention !== null && !attentionAvailable) warnings.push("待办响应格式不受支持；待办数量未知。");
  // User-owned tasks are real work records but are not necessarily emitted by the attention feed.
  const humanTasks: PaperclipAttention[] = rawTasks.filter((task) => task.companyId === config.companyId && task.assigneeUserId && !["done", "cancelled"].includes(str(task.status))).filter((task) => !rows(attention.items).some((item) => row(item.subject).kind === "issue" && row(item.subject).id === task.id)).map((task) => ({
    id: `human-task:${str(task.id)}`, subjectId: str(task.id), sourceKind: "human_task", title: str(task.title),
    whyNow: nullable(row(task.unblockDescriptor).action) || "此任务明确分派给人工，需要你完成任务中要求的操作或回应。",
    summary: nullable(task.description), severity: str(task.priority), href: taskHref(task), issueId: str(task.id), issueIdentifier: nullable(task.identifier),
    originAgentName: null, decideBy: null, resolverPolicy: null, resolverName: nullable(task.assigneeUserId), audience: "human", options: [],
  }));
  return {
    fetchedAt: new Date().toISOString(),
    company: { id: config.companyId, name: str(company.name), prefix, href: href(null, "dashboard") },
    links: { tasks: href(null, "issues"), decisions: href(null, "decisions"), artifacts: href(null, "artifacts"), agents: href(null, "agents") },
    agents: rows(rawAgents).filter((agent) => agent.companyId === config.companyId).map((agent) => ({
      id: str(agent.id), name: str(agent.name), role: str(agent.role), title: nullable(agent.title),
      status: str(agent.status), adapterType: str(agent.adapterType), href: href(null, `agents/${encodeURIComponent(str(agent.id))}`),
    })),
    tasks: rawTasks.filter((task) => task.companyId === config.companyId).map((task) => ({
      id: str(task.id), identifier: str(task.identifier, str(task.id)), title: str(task.title), description: nullable(task.description),
      status: str(task.status), priority: str(task.priority), assigneeAgentId: nullable(task.assigneeAgentId),
      assigneeUserId: nullable(task.assigneeUserId), unblockAction: nullable(row(task.unblockDescriptor).action),
      blockedBy: rows(task.blockedBy).map((blocker) => ({ id: str(blocker.id), identifier: str(blocker.identifier, str(blocker.id)), title: str(blocker.title), href: taskHref(blocker) })),
      projectId: nullable(task.projectId), updatedAt: nullable(task.updatedAt), href: taskHref(task),
    })),
    projects: rows(rawProjects).map((project) => ({ id: str(project.id), name: str(project.name) })),
    liveRuns: rows(rawLive).filter((run) => ["running", "queued"].includes(str(run.status)) && !run.finishedAt).map(mapRun),
    liveAvailable: Array.isArray(rawLive),
    recentRuns: rows(rawRecent).map(mapRun),
    attention: {
      available: attentionAvailable,
      total: (typeof attention.totalCount === "number" ? attention.totalCount : rows(attention.items).length) + humanTasks.length,
      items: [...humanTasks, ...rows(attention.items).filter((item) => item.companyId === config.companyId).map((item): PaperclipAttention => {
        const subject = row(item.subject), issue = row(item.relatedIssue), detail = row(item.detail), audience = row(item.resolverAudience);
        const policy = nullable(audience.effectiveResolverPolicy);
        const issueId = attentionIssueId(item);
        const issueRecord = rawTasks.find((task) => task.id === issueId) ?? {};
        return {
          id: str(item.id), subjectId: str(subject.id), sourceKind: str(item.sourceKind), title: str(subject.title, "待处理事项"), whyNow: str(item.whyNow),
          summary: nullable(detail.summaryExcerpt) || nullable(detail.promptExcerpt) || nullable(detail.firstQuestionText) || nullable(detail.failureReasonExcerpt),
          severity: str(item.severity), href: href(subject.href, "decisions"), issueId, issueIdentifier: (subject.kind === "issue" ? nullable(subject.identifier) : null) || nullable(issue.identifier) || nullable(issueRecord.identifier),
          originAgentName: nullable(item.originAgentName), decideBy: nullable(item.decideBy), resolverPolicy: policy, resolverName: nullable(audience.addresseeName),
          audience: item.sourceKind === "review" ? reviewAudience(issueRecord, approvalIssueIds.has(issueId)) : item.sourceKind === "blocker_attention" ? blockerAudience(issueRecord) : attentionAudience(str(item.sourceKind), policy), options: rows(item.decisionVerbs).map((verb) => str(verb.label)),
        };
      })],
    },
    artifacts: rows(artifacts.artifacts).map((artifact) => ({
      id: str(artifact.id), title: str(artifact.title), source: str(artifact.source), preview: nullable(artifact.previewText),
      issueId: str(row(artifact.issue).id), issueIdentifier: str(row(artifact.issue).identifier), agentId: nullable(row(artifact.createdByAgent).id),
      updatedAt: nullable(artifact.updatedAt), href: href(artifact.href, `issues/${encodeURIComponent(str(row(artifact.issue).identifier) || str(row(artifact.issue).id))}`),
    })),
    warnings,
  };
}

/** On-demand details avoid fetching every document/interaction on every poll. */
export async function loadPaperclipIssueContext(issueId: string): Promise<PaperclipIssueContext> {
  const config = readPaperclipConfig();
  const get = async (path: string) => {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/api${path}`, {
        method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      });
    } catch { throw new PaperclipConnectionError("无法读取任务的审核详情。"); }
    if (!response.ok) throw new PaperclipConnectionError(`审核详情读取失败（HTTP ${response.status}）。`);
    return response.json();
  };
  const issue = row(await get(`/issues/${encodeURIComponent(issueId)}`));
  if (issue.companyId !== config.companyId) throw new PaperclipConnectionError("该任务不属于当前公司。", 403);
  const warnings: string[] = [];
  let interactions: Row[] = [];
  try { interactions = rows(await get(`/issues/${encodeURIComponent(issueId)}/interactions`)); }
  catch { warnings.push("任务问答详情读取失败；无法确认请求绑定的版本与唤醒策略。"); }
  const company = row(await get(`/companies/${encodeURIComponent(config.companyId)}`));
  const principal = (value: unknown) => {
    const candidate = row(value);
    return candidate.type === "agent" || candidate.type === "user" ? { type: str(candidate.type), id: nullable(candidate.agentId) || nullable(candidate.userId) } : null;
  };
  const state = row(issue.executionState);
  const stages = rows(row(issue.executionPolicy).stages);
  const currentIndex = typeof state.currentStageIndex === "number" ? state.currentStageIndex : stages.findIndex((stage) => stage.id === state.currentStageId);
  const next = currentIndex >= 0 ? stages[currentIndex + 1] : null;
  return {
    issueId: str(issue.id), identifier: str(issue.identifier),
    reviewer: state.status === "pending" ? principal(state.currentParticipant) : null,
    reviewInstructions: nullable(row(state.reviewRequest).instructions),
    returnAssignee: principal(state.returnAssignee),
    nextStage: next ? { type: str(next.type), participants: rows(next.participants).map(principal).filter((value) => value !== null) } : null,
    documents: rows(issue.documentSummaries).map((document) => ({
      key: str(document.key), title: str(document.title) || str(document.key), revision: typeof document.latestRevisionNumber === "number" ? document.latestRevisionNumber : null,
      revisionId: nullable(document.latestRevisionId), href: paperclipHref(config.baseUrl, str(company.issuePrefix), null, `issues/${encodeURIComponent(str(issue.identifier) || issueId)}#document-${encodeURIComponent(str(document.key))}`),
    })),
    interactions: interactions.map((interaction) => {
      const target = row(row(interaction.payload).target);
      return { id: str(interaction.id), status: str(interaction.status), continuation: str(interaction.continuationPolicy), target: Object.keys(target).length ? {
        key: str(target.key), label: nullable(target.label), revision: typeof target.revisionNumber === "number" ? target.revisionNumber : null, revisionId: nullable(target.revisionId),
      } : null };
    }), warnings,
  };
}

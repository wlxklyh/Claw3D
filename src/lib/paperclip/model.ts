import type { PaperclipAgent, PaperclipAttention, PaperclipRun } from "./types";

export function snapshotIsFresh(fetchedAt: string | undefined, now: number) {
  const age = now - Date.parse(fetchedAt ?? "");
  return Number.isFinite(age) && age >= 0 && age < 30000;
}

export function splitAttention(items: PaperclipAttention[]) {
  return { human: items.filter((item) => item.audience === "human"), other: items.filter((item) => item.audience !== "human") };
}

/** Assignment and in_progress are workflow states, never proof of a live process. */
export function agentRuntimeState(agent: PaperclipAgent, runs: PaperclipRun[], fresh = true) {
  if (!fresh) return { scene: "idle" as const, label: "状态待更新" };
  const live = runs.filter((run) => run.agentId === agent.id && !run.finishedAt);
  if (live.some((run) => run.status === "running")) {
    return { scene: "working" as const, label: "运行中" };
  }
  if (live.some((run) => run.status === "queued")) {
    return { scene: "idle" as const, label: "排队中" };
  }
  if (agent.status === "error") return { scene: "error" as const, label: "发生错误" };
  if (agent.status === "paused") return { scene: "idle" as const, label: "已暂停" };
  if (agent.status === "pending_approval") return { scene: "idle" as const, label: "待入职审批" };
  if (agent.status === "terminated") return { scene: "idle" as const, label: "已停用" };
  return { scene: "idle" as const, label: "未观测到运行" };
}

export const taskStatusLabel = (status: string) => ({
  backlog: "待规划", todo: "待开始", in_progress: "进行中", in_review: "验收中",
  blocked: "已阻塞", done: "已完成", cancelled: "已取消",
}[status] ?? status);

export const runStatusLabel = (status: string) => ({
  queued: "排队中", running: "运行中", succeeded: "成功", failed: "失败",
  cancelled: "已取消", timed_out: "超时",
}[status] ?? status);

export const attentionAudienceLabel = (audience: string) => ({
  human: "必须你处理", shared: "你或获授权 Agent", agent: "指定 Agent 处理", check: "需查看处理规则",
}[audience] ?? "需查看处理规则");

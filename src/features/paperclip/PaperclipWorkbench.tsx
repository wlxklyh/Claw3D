"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaperclipSnapshot } from "@/lib/paperclip/types";
import { agentRuntimeState, attentionAudienceLabel, runStatusLabel, snapshotIsFresh, splitAttention, taskStatusLabel } from "@/lib/paperclip/model";
import type { OfficeDeskMonitor } from "@/lib/office/deskMonitor";
import styles from "./workbench.module.css";
import { AttentionContext } from "./AttentionContext";
import { OfficeBoundary } from "./OfficeBoundary";

const Office = dynamic(() => import("@/features/retro-office/RetroOffice3D").then((module) => module.RetroOffice3D), {
  ssr: false, loading: () => <div className={styles.empty}>正在载入 3D 办公室…</div>,
});
const COLORS = ["#4f9ad1", "#bb8bea", "#ddab4e", "#62b6a1", "#e38982", "#a5b5d6"];
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未记录";
const sourceLabel = (value: string) => ({ human_task: "人工任务", approval: "审批", decision: "决策", issue_thread_interaction: "任务问答 / 确认", review: "任务验收", recovery_action: "恢复操作", blocker_attention: "任务阻塞", failed_run: "运行失败", agent_error_alert: "Agent 异常", budget_alert: "预算提醒", join_request: "加入申请" }[value] ?? value);
function OutLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return <a className={primary ? styles.primary : styles.link} href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span></a>;
}

export function PaperclipWorkbench() {
  const [data, setData] = useState<PaperclipSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [agentId, setAgentId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [attentionId, setAttentionId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [showOffice, setShowOffice] = useState(true);
  const [centerSignal, setCenterSignal] = useState(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/paperclip/snapshot", { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `读取失败：HTTP ${response.status}`);
      if (alive.current) { setData(payload); setError(null); setNow(Date.now()); }
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error && failure.name === "TimeoutError" ? "读取超时，将自动重试。" : failure instanceof Error ? failure.message : "连接失败。");
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) await refresh();
      if (!stopped) timer = setTimeout(poll, 8000);
    };
    void poll();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; alive.current = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = Boolean(data) && !snapshotIsFresh(data?.fetchedAt, now);
  const fresh = !error && !expired && Boolean(data?.liveAvailable);
  const officeAgents = useMemo(() => (data?.agents ?? []).filter((agent) => agent.status !== "terminated").map((agent, index) => ({
    id: agent.id, name: agent.name, subtitle: agentRuntimeState(agent, data?.liveRuns ?? [], fresh).label,
    status: agentRuntimeState(agent, data?.liveRuns ?? [], fresh).scene, color: COLORS[index % COLORS.length], item: "laptop",
  })), [data, fresh]);
  const monitors = useMemo(() => Object.fromEntries((data?.agents ?? []).map((agent) => {
    const live = data?.liveRuns.find((run) => run.agentId === agent.id && run.status === "running");
    const task = live?.issueId ? data?.tasks.find((candidate) => candidate.id === live.issueId) : null;
    const state = agentRuntimeState(agent, data?.liveRuns ?? [], fresh);
    const monitor: OfficeDeskMonitor = {
      agentId: agent.id, agentName: agent.name, mode: state.scene === "error" ? "error" : live && fresh ? "browser" : "idle",
      title: task ? `${task.identifier} · ${task.title}` : state.label,
      subtitle: live && fresh ? `Paperclip run ${live.id}` : "任务分配不代表正在执行",
      browserUrl: task?.href ?? agent.href, updatedAt: live?.lastOutputAt ? Date.parse(live.lastOutputAt) : null,
      live: Boolean(live && fresh), entries: task ? [{ kind: "user", text: task.title }] : [], editor: null,
    };
    return [agent.id, monitor];
  })), [data, fresh]);
  const selectedAgent = data?.agents.find((agent) => agent.id === agentId);
  const tasks = (data?.tasks ?? []).filter((task) => (!agentId || task.assigneeAgentId === agentId) && (!projectId || task.projectId === projectId));
  const selectedTask = tasks.find((task) => task.id === taskId);
  const queues = splitAttention(data?.attention.items ?? []);
  const attention = data?.attention.items.find((item) => item.id === attentionId) ?? queues.human[0] ?? queues.other[0];
  const attentionTask = data?.tasks.find((task) => task.id === attention?.issueId);
  const affectedTasks = (data?.tasks ?? []).filter((task) => task.blockedBy.some((blocker) => blocker.id === attention?.issueId));
  const artifacts = (data?.artifacts ?? []).filter((artifact) => (!agentId || artifact.agentId === agentId) && (!projectId || data?.tasks.some((task) => task.id === artifact.issueId && task.projectId === projectId)));
  const recentRuns = (data?.recentRuns ?? []).filter((run) => !agentId || run.agentId === agentId);

  return <div className={styles.shell} lang="zh-CN">
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>CLAW3D × PAPERCLIP</div><h1>{data?.company.name || "Agent 工作台"}</h1><p>真实任务与运行 · 每 8 秒读取 · 点击角色查看工作</p></div>
      <nav className={styles.headerActions} aria-label="工作台导航">
        {data && <><OutLink href={data.links.tasks}>新建 / 分派任务</OutLink><a className={styles.primary} href="#human-inbox">人工待办 {data.attention.available ? `· ${queues.human.length}` : "· 未知"}</a></>}
        <button onClick={() => void refresh()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </nav>
    </header>
    <div className={styles.connection} role="status"><span className={error || expired ? styles.warningDot : styles.dot} />{data ? `${error ? "连接中断 · 以下为上次读取" : expired ? "快照已过期 · 等待更新" : "已连接"} · ${dateLabel(data.fetchedAt)}` : loading ? "连接 Paperclip…" : "尚未连接"}</div>
    {error && <div className={styles.warning} role="alert">{error}{data && <span> 旧数据已停止标记为运行中。</span>}</div>}
    {data?.warnings.map((warning) => <div className={styles.warning} key={warning}>{warning}</div>)}
    {!data ? <section className={styles.setup}><h2>连接真实公司</h2><p>在 Claw3D 的 <code>.env.local</code> 配置本机 Paperclip 地址与公司 ID。</p><pre>{"PAPERCLIP_BASE_URL=http://127.0.0.1:3100\nPAPERCLIP_COMPANY_ID=<公司 UUID>"}</pre><p>重启 Claw3D 后刷新。此页面不会创建示例 Agent 或任务。</p></section> : <div className={styles.columns}>
      <div className={styles.main}>
        <section className={styles.panel} aria-label="3D 现场">
          <div className={styles.sectionTitle}><h2>工作现场 <span>{data.agents.length} 个岗位</span></h2><div className={styles.inlineActions}><button onClick={() => setCenterSignal((value) => value + 1)}>回到全景</button><button onClick={() => setShowOffice((value) => !value)} aria-expanded={showOffice}>{showOffice ? "收起 3D" : "展开 3D"}</button></div></div>
          {showOffice && <div className={styles.scene}><OfficeBoundary><Office agents={officeAgents} readOnly storageNamespace={`paperclip-${data.company.id}`} officeTitle={data.company.name} officeTitleLoaded officeCenterSignal={centerSignal} monitorByAgentId={monitors} onAgentChatSelect={setAgentId} /></OfficeBoundary></div>}
          <p className={styles.sceneNote}>运行标识来自 Paperclip；角色行走是空间表现，不表示正在调用工具。</p>
          <div className={styles.agentGrid}>{data.agents.map((agent, index) => {
            const state = agentRuntimeState(agent, data.liveRuns, fresh);
            const live = fresh ? data.liveRuns.find((run) => run.agentId === agent.id && run.status === "running") : undefined;
            const current = data.tasks.find((task) => task.id === live?.issueId);
            return <button key={agent.id} className={`${styles.agent} ${agentId === agent.id ? styles.selected : ""}`} onClick={() => setAgentId(agentId === agent.id ? null : agent.id)} aria-pressed={agentId === agent.id}>
              <span className={styles.agentHeading}><span className={styles.avatar} style={{ backgroundColor: COLORS[index % COLORS.length] }}>{agent.name.slice(0, 1)}</span><strong>{agent.name}</strong></span>
              <span className={styles.muted}>{agent.title || agent.role} · {agent.adapterType}</span>
              <span className={styles.state} data-state={state.scene}>{state.label}</span><span className={styles.currentTask}>{current ? `${current.identifier} · ${current.title}` : live ? `run ${live.id.slice(0, 8)}` : `${data.tasks.filter((task) => task.assigneeAgentId === agent.id && !["done", "cancelled"].includes(task.status)).length} 条未完成任务`}</span>
            </button>;
          })}</div>
          {!data.agents.length && <p className={styles.empty}>这个公司还没有 Agent。</p>}
        </section>
        <section className={styles.panel} aria-label="任务">
          <div className={styles.sectionTitle}><h2>{selectedAgent ? `${selectedAgent.name}的任务` : "所有任务"} <span>{tasks.length}</span></h2><div className={styles.inlineActions}>{selectedAgent && <button onClick={() => setAgentId(null)}>所有岗位</button>}<label className={styles.projectFilter}>项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div></div>
          <div className={styles.taskList}>{tasks.map((task) => <button key={task.id} className={`${styles.task} ${task.id === selectedTask?.id ? styles.selected : ""}`} onClick={() => setTaskId(task.id)}><span><small>{task.identifier}</small><strong>{task.title}</strong><span className={styles.muted}>{task.assigneeUserId ? "人工负责" : data.agents.find((agent) => agent.id === task.assigneeAgentId)?.name || "未分派"}</span></span><span className={styles.badge}>{taskStatusLabel(task.status)}</span></button>)}</div>
          {!tasks.length && <p className={styles.empty}>当前筛选没有任务。</p>}
          {selectedTask && <div className={styles.detail}><div className={styles.sectionTitle}><h3>{selectedTask.identifier}</h3><OutLink href={selectedTask.href} primary>查看任务 / 分派</OutLink></div><p>{selectedTask.title}</p>{selectedTask.unblockAction && <p className={styles.warning}>{selectedTask.unblockAction}</p>}{selectedTask.blockedBy.map((blocker) => <OutLink key={blocker.id} href={blocker.href}>等待 {blocker.identifier} · {blocker.title}</OutLink>)}{selectedTask.description && <p className={styles.description}>{selectedTask.description}</p>}<small>任务状态：{taskStatusLabel(selectedTask.status)} · 更新时间：{dateLabel(selectedTask.updatedAt)}</small></div>}
        </section>
        <section className={styles.panel} aria-label="成果"><div className={styles.sectionTitle}><h2>成果 <span>{artifacts.length}</span></h2><OutLink href={data.links.artifacts}>打开成果库</OutLink></div>{artifacts.length ? <div className={styles.artifacts}>{artifacts.map((artifact) => <a href={artifact.href} target="_blank" rel="noopener noreferrer" key={artifact.id} className={styles.artifact}><small>{artifact.issueIdentifier} · {({ document: "文档", attachment: "附件", work_product: "工作产物" }[artifact.source] ?? artifact.source)}</small><strong>{artifact.title} ↗</strong>{artifact.preview && <p>{artifact.preview}</p>}<small>{dateLabel(artifact.updatedAt)}</small></a>)}</div> : <p className={styles.empty}>当前筛选没有已登记成果。任务“完成”不会被转换成虚构产物。</p>}</section>
        <section className={styles.panel} aria-label="运行记录"><div className={styles.sectionTitle}><h2>最近运行 <span>{selectedAgent?.name ?? "所有岗位"}</span></h2>{selectedAgent && <OutLink href={selectedAgent.href}>Agent 详情</OutLink>}</div>{recentRuns.slice(0, 8).map((run) => <div className={styles.run} key={run.id}><span><strong>{data.agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}</strong><small>{run.id.slice(0, 8)} · {dateLabel(run.startedAt)}{run.livenessState && !run.endReason ? ` · ${run.livenessState}` : ""}</small>{run.endReason === "task_handoff" && <small>因任务交接结束</small>}</span><span className={styles.badge}>{runStatusLabel(run.status)}</span><OutLink href={run.href}>日志</OutLink></div>)}{!recentRuns.length && <p className={styles.empty}>尚无可读取的运行记录。</p>}</section>
      </div>
      <aside className={`${styles.panel} ${styles.inbox}`} id="human-inbox" aria-label="人工待办">
        <div className={styles.sectionTitle}><h2>人工待办</h2><span className={styles.count}>{data.attention.available ? queues.human.length : "?"}</span></div>
        <p className={styles.muted}>只计明确需要人工处理的事项。Agent 协作与异常另列，避免把等待依赖算成人审。</p>
        <OutLink href={data.links.decisions} primary>打开 Paperclip 决策台</OutLink>
        {!data.attention.available && <p className={styles.warning}>待办未能读取，不能认定为零。请在决策台确认。</p>}
        {data.attention.available && !queues.human.length && <p className={styles.empty}>当前没有明确需要你处理的事项。</p>}
        {[queues.human, queues.other].map((items, index) => items.length ? <div key={index}>
          {index === 1 && <h3 className={styles.queueHeading}>协作与异常 <span>{items.length}</span></h3>}
          <div className={styles.attentionList}>{items.map((item) => <button key={item.id} className={`${styles.attention} ${attention?.id === item.id ? styles.selected : ""}`} onClick={() => setAttentionId(item.id)} aria-pressed={attention?.id === item.id}><span className={styles.attentionTop}><small>{sourceLabel(item.sourceKind)}</small><span className={item.audience === "human" ? styles.human : styles.badge}>{attentionAudienceLabel(item.audience)}</span></span><strong>{item.title}</strong><span className={styles.muted}>{item.issueIdentifier || "公司事项"}{item.originAgentName ? ` · ${item.originAgentName}` : ""}</span></button>)}</div>
        </div> : null)}
        {attention && <div className={styles.attentionDetail}><h3>{attention.title}</h3><dl>
          <dt>项目</dt><dd>{data.projects.find((project) => project.id === attentionTask?.projectId)?.name || "未提供"}</dd>
          <dt>提交岗位</dt><dd>{attention.originAgentName || "未提供，请在原始事项核对。"}</dd>
          <dt>为什么需要处理</dt><dd>{attention.whyNow || "Paperclip 未提供原因，请打开事项查看。"}</dd>
          {attention.summary && <><dt>请求内容</dt><dd className={styles.requestContent}>{attention.summary}</dd></>}
          <dt>谁可以处理</dt><dd>{attentionAudienceLabel(attention.audience)}{attention.resolverName ? ` · ${attention.resolverName}` : ""}{attention.resolverPolicy ? <small>规则：{attention.resolverPolicy}</small> : null}</dd>
          <dt>关联任务</dt><dd>{attention.issueIdentifier || "无关联任务编号"}</dd>
          {attentionTask?.blockedBy.length ? <><dt>需要先完成</dt><dd>{attentionTask.blockedBy.map((blocker) => <OutLink key={blocker.id} href={blocker.href}>{blocker.identifier} · {blocker.title}</OutLink>)}</dd></> : null}
          {affectedTasks.length > 0 && <><dt>受影响的任务与岗位</dt><dd>{affectedTasks.map((task) => <div key={task.id}><OutLink href={task.href}>{task.identifier} · {data.agents.find((agent) => agent.id === task.assigneeAgentId)?.name || "人工任务"}</OutLink><small>{task.title} · {taskStatusLabel(task.status)}</small></div>)}</dd></>}
          {attention.decideBy && <><dt>期望处理时间</dt><dd>{dateLabel(attention.decideBy)}</dd></>}
          {attention.options.length > 0 && <><dt>原系统可用操作</dt><dd>{attention.options.join(" / ")}</dd></>}
        </dl>{attention.sourceKind === "human_task" ? <p className={styles.footnote}>这是实际分派给人工的任务。完成操作后按任务要求回应；是否恢复执行，以后续核验和调度记录为准。</p> : <AttentionContext item={attention} agents={data.agents} refreshedAt={data.fetchedAt} />}
          <OutLink href={attention.href} primary>{attention.sourceKind === "human_task" ? "打开任务并操作" : "打开此事项并处理"}</OutLink><p className={styles.footnote}>操作在 Paperclip 原始事项中完成，保留权限校验与审计记录。</p></div>}
      </aside>
    </div>}
  </div>;
}

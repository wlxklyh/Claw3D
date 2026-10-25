"use client";

import { useEffect, useState } from "react";
import type { PaperclipAgent, PaperclipAttention, PaperclipIssueContext } from "@/lib/paperclip/types";
import styles from "./workbench.module.css";

export function AttentionContext({ item, agents, refreshedAt }: { item: PaperclipAttention; agents: PaperclipAgent[]; refreshedAt: string }) {
  const [result, setResult] = useState<{ issueId: string; value?: PaperclipIssueContext; error?: string } | null>(null);
  useEffect(() => {
    if (!item.issueId) return;
    const issueId = item.issueId;
    const controller = new AbortController();
    void fetch(`/api/paperclip/issues/${encodeURIComponent(issueId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; })
      .then((value) => setResult({ issueId, value }))
      .catch((error) => { if (!controller.signal.aborted) setResult({ issueId, error: error instanceof Error ? error.message : "审核详情读取失败" }); });
    return () => controller.abort();
  }, [item.issueId, refreshedAt]);
  const name = (principal: { type: string; id: string | null }) => principal.type === "user" ? `人工${principal.id ? `（${principal.id}）` : ""}` : agents.find((agent) => agent.id === principal.id)?.name || `Agent ${principal.id}`;
  if (!item.issueId) return <p className={styles.footnote}>此公司事项的具体影响与后续动作，请在原始决策中核对。</p>;
  if (result?.issueId !== item.issueId) return <p className={styles.footnote}>正在读取审核版本与后续流程…</p>;
  if (result.error || !result.value) return <p className={styles.warning}>{result.error || "审核详情不可用。"}</p>;
  const context = result.value;
  const interaction = context.interactions.find((candidate) => candidate.id === item.subjectId);
  const target = interaction?.target;
  const currentDocument = target ? context.documents.find((document) => document.key === target.key) : null;
  const changed = target?.revisionId && currentDocument?.revisionId && target.revisionId !== currentDocument.revisionId;
  const continuation = interaction ? ({ none: "没有配置自动唤醒；处理后需在任务中安排下一步。", wake_assignee: "提交回应后，系统按配置唤醒任务当前负责人。", wake_assignee_on_accept: "仅接受后按配置唤醒任务当前负责人；拒绝不会按此策略唤醒。" }[interaction.continuation] ?? `服务端继续策略：${interaction.continuation}`) : null;
  return <div className={styles.context}>
    {context.warnings.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
    <dl>{context.reviewer && <><dt>当前验收者</dt><dd>{name(context.reviewer)}{context.reviewer.type === "agent" ? " · AI 验收" : " · 人工验收"}</dd></>}
      {context.reviewInstructions && <><dt>验收要求</dt><dd>{context.reviewInstructions}</dd></>}
      <dt>请求绑定的产物版本</dt><dd>{target ? <>{target.label || target.key} · {target.revision !== null ? `v${target.revision}` : "未提供版本号"}{target.revisionId && <small>revision {target.revisionId}</small>}{changed && <p className={styles.warning}>当前文档已经变化，请核对请求绑定版本；不能将新版本视为已获批准。</p>}</> : "此事项未绑定明确的文档修订；请在原始事项核对审核对象。"}</dd>
      {context.documents.length > 0 && <><dt>任务现有文档（当前版本）</dt><dd>{context.documents.map((document) => <a className={styles.documentLink} key={document.key} href={document.href} target="_blank" rel="noopener noreferrer">{document.title} · {document.revision !== null ? `v${document.revision}` : "版本未记录"} ↗</a>)}</dd></>}
      <dt>决定之后</dt><dd>{continuation || (context.nextStage ? `通过后进入 ${context.nextStage.type} 阶段：${context.nextStage.participants.map(name).join("、")}` : "没有可确认的后续阶段；具体执行以 Paperclip 处理结果为准。")}{context.returnAssignee && <small>退回修改的负责人：{name(context.returnAssignee)}</small>}</dd>
    </dl>
  </div>;
}

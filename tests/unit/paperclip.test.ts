import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRuntimeState, snapshotIsFresh, splitAttention } from "@/lib/paperclip/model";
import { attentionAudience, attentionIssueId, blockerAudience, loadPaperclipSnapshot, paperclipHref, readPaperclipConfig, reviewAudience } from "@/lib/paperclip/server";
import type { PaperclipAgent, PaperclipAttention, PaperclipRun } from "@/lib/paperclip/types";

const agent: PaperclipAgent = { id: "a", name: "Engineer", role: "engineer", title: null, status: "running", adapterType: "codex_local", href: "http://localhost/TEST/agents/a" };
const run = (status: string, finishedAt: string | null = null): PaperclipRun => ({ id: "r", agentId: "a", issueId: "task", status, startedAt: null, finishedAt, lastOutputAt: null, livenessState: null, livenessReason: null, endReason: null, href: "" });

afterEach(() => { vi.unstubAllEnvs(); });

describe("Paperclip observation boundaries", () => {
  it("expires cached running evidence even while the next request has not settled", () => {
    const fetchedAt = "2026-01-01T00:00:00Z";
    const timestamp = Date.parse(fetchedAt);
    expect(snapshotIsFresh(fetchedAt, timestamp)).toBe(true);
    expect(snapshotIsFresh(fetchedAt, timestamp + 29999)).toBe(true);
    expect(snapshotIsFresh(fetchedAt, timestamp + 30000)).toBe(false);
    expect(snapshotIsFresh(fetchedAt, timestamp - 1)).toBe(false);
    expect(snapshotIsFresh(undefined, timestamp)).toBe(false);
    expect(snapshotIsFresh("invalid", timestamp)).toBe(false);
    expect(agentRuntimeState(agent, [run("running")], snapshotIsFresh(fetchedAt, timestamp + 30000)).label).toBe("状态待更新");
  });
  it("requires an observed running process, not roster status, queue, or historical completion", () => {
    expect(agentRuntimeState(agent, []).scene).toBe("idle");
    expect(agentRuntimeState(agent, [run("queued")]).scene).toBe("idle");
    expect(agentRuntimeState(agent, [run("running", "2026-01-01T00:00:00Z")]).scene).toBe("idle");
    expect(agentRuntimeState(agent, [run("running")]).scene).toBe("working");
    expect(agentRuntimeState(agent, [run("running")], false).scene).toBe("idle");
  });
  it("keeps canonical human review separate from shared and unknown resolver policies", () => {
    expect(attentionAudience("issue_thread_interaction", "human_only")).toBe("human");
    expect(attentionAudience("issue_thread_interaction", "board_only")).toBe("human");
    expect(attentionAudience("issue_thread_interaction", "not_creator")).toBe("shared");
    expect(attentionAudience("issue_thread_interaction", "anyone")).toBe("shared");
    expect(attentionAudience("review", null)).toBe("check");
    expect(attentionAudience("recovery_action", null)).toBe("human");
  });
  it("identifies the actual current execution reviewer without turning stalled AI review into human approval", () => {
    expect(reviewAudience({ executionState: { status: "pending", currentParticipant: { type: "user", userId: "u" } } })).toBe("human");
    expect(reviewAudience({ executionState: { status: "pending", currentParticipant: { type: "agent", agentId: "qa" } } })).toBe("agent");
    expect(reviewAudience({ assigneeUserId: "u" })).toBe("human");
    expect(reviewAudience({ reviewAttention: { state: "stalled" } })).toBe("check");
  });
  it("identifies a human unblock owner without treating every failed run as human approval", () => {
    expect(blockerAudience({ unblockDescriptor: { owner: "board", action: "Repair" } })).toBe("human");
    expect(blockerAudience({ unblockDescriptor: { owner: { userId: "u" } } })).toBe("human");
    expect(blockerAudience({ unblockDescriptor: { owner: { agentId: "a" } } })).toBe("agent");
    expect(blockerAudience({})).toBe("check");
  });
  it("keeps normal Agent dependencies and unknown exceptions out of the human count without hiding them", () => {
    const items = ["human", "agent", "shared", "check"].map((audience, i) => ({ id: String(i), audience } as PaperclipAttention));
    expect(splitAttention(items).human.map((item) => item.id)).toEqual(["0"]);
    expect(splitAttention(items).other.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });
  it("resolves the terminal blocker itself rather than using the affected parent as its owner", () => {
    expect(attentionIssueId({ subject: { kind: "issue", id: "terminal" }, relatedIssue: { id: "parent" } })).toBe("terminal");
    expect(attentionIssueId({ subject: { kind: "run", id: "run" }, relatedIssue: { id: "parent" } })).toBe("parent");
    expect(attentionIssueId({ subject: { kind: "approval", metadata: { issueId: "approved-task" } } })).toBe("approved-task");
  });
  it("preserves exact task anchors and decision IDs while rejecting cross-company or external links", () => {
    const href = (path: string) => paperclipHref("http://127.0.0.1:3100", "TEST", path, "decisions");
    expect(href("/TEST/issues/TEST-1#interaction-123")).toBe("http://127.0.0.1:3100/TEST/issues/TEST-1#interaction-123");
    expect(href("/TEST/decisions?decisionId=123")).toContain("?decisionId=123");
    for (const path of ["https://example.com/TEST/issues/1", "//example.com/TEST/issues/1", "javascript:alert(1)", "/OTHER/issues/1", "/TEST/../OTHER/issues/1"]) {
      expect(href(path)).toBe("http://127.0.0.1:3100/TEST/decisions");
    }
  });
  it("fails clearly without a configured company or with credential-bearing service URLs", () => {
    expect(() => readPaperclipConfig({})).toThrow("PAPERCLIP_COMPANY_ID");
    expect(() => readPaperclipConfig({ PAPERCLIP_COMPANY_ID: "c", PAPERCLIP_BASE_URL: "http://user:secret@localhost:3100" })).toThrow("没有凭据");
  });
  it("exposes only presentation fields, preserves partial failures, and makes exclusively GET requests", async () => {
    vi.stubEnv("PAPERCLIP_COMPANY_ID", "c");
    vi.stubEnv("PAPERCLIP_BASE_URL", "http://127.0.0.1:3100");
    vi.stubEnv("PAPERCLIP_API_TOKEN", "test-server-secret");
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname;
      expect(init?.method).toBe("GET");
      if (path.endsWith("/attention")) return Response.json({ error: "board user required" }, { status: 403 });
      if (path.endsWith("/agents")) return Response.json([{ ...agent, companyId: "c", adapterConfig: { env: { SECRET: "not-for-browser" } } }]);
      if (path.endsWith("/issues")) {
        expect(url.searchParams.get("sortField")).toBe("updated");
        expect(url.searchParams.get("sortDir")).toBe("desc");
        expect(url.searchParams.get("includeBlockedBy")).toBe("true");
        return Response.json([{ id: "task", identifier: "TEST-1", companyId: "c", title: "Actual record", status: "todo", assigneeAgentId: "a" }, { id: "manual", identifier: "TEST-2", companyId: "c", title: "Manual operation", status: "todo", assigneeUserId: "u" }]);
      }
      if (path.endsWith("/artifacts")) return Response.json({ artifacts: [], nextCursor: null });
      if (path.endsWith("/heartbeat-runs")) return Response.json([
        { id: "handoff", agentId: "a", status: "cancelled", error: "Cancelled before issue reassignment" },
        { id: "paused", agentId: "a", status: "cancelled", error: "Cancelled due to agent pause" },
        { id: "failure", agentId: "a", status: "failed", error: "Cancelled before issue reassignment" },
      ]);
      if (path.endsWith("/c")) return Response.json({ id: "c", name: "Test", issuePrefix: "TEST" });
      return Response.json([]);
    });
    const snapshot = await loadPaperclipSnapshot(fakeFetch as typeof fetch);
    expect(snapshot.attention.available).toBe(false);
    expect(snapshot.warnings.join(" ")).toContain("不能视为空");
    expect(snapshot.tasks[0].href).toBe("http://127.0.0.1:3100/TEST/issues/TEST-1");
    expect(snapshot.attention.items[0]).toMatchObject({ sourceKind: "human_task", audience: "human", issueIdentifier: "TEST-2", href: "http://127.0.0.1:3100/TEST/issues/TEST-2" });
    expect(snapshot.recentRuns.map(({ status, endReason }) => ({ status, endReason }))).toEqual([
      { status: "cancelled", endReason: "task_handoff" },
      { status: "cancelled", endReason: null },
      { status: "failed", endReason: null },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("not-for-browser");
    expect(JSON.stringify(snapshot)).not.toContain("test-server-secret");
    expect(fakeFetch.mock.calls.every(([input]) => !String(input).includes("minCount"))).toBe(true);
  });
});

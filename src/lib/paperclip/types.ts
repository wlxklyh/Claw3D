/** Deliberately small browser DTOs: never expose adapter config or credentials. */
export type PaperclipAgent = {
  id: string; name: string; role: string; title: string | null;
  status: string; adapterType: string; href: string;
};
export type PaperclipTask = {
  id: string; identifier: string; title: string; description: string | null;
  status: string; priority: string; assigneeAgentId: string | null; assigneeUserId: string | null;
  blockedBy: { id: string; identifier: string; title: string; href: string }[];
  unblockAction: string | null;
  projectId: string | null; updatedAt: string | null; href: string;
};
export type PaperclipRun = {
  id: string; agentId: string; issueId: string | null; status: string;
  startedAt: string | null; finishedAt: string | null;
  lastOutputAt: string | null; livenessState: string | null;
  livenessReason: string | null; href: string;
  endReason: "task_handoff" | null;
};
export type PaperclipAttention = {
  id: string; subjectId: string; sourceKind: string; title: string; whyNow: string;
  summary: string | null; severity: string; href: string;
  issueId: string | null; issueIdentifier: string | null;
  originAgentName: string | null; decideBy: string | null;
  resolverPolicy: string | null; resolverName: string | null;
  audience: "human" | "shared" | "agent" | "check";
  options: string[];
};
export type PaperclipIssueContext = {
  issueId: string; identifier: string;
  reviewer: { type: string; id: string | null } | null;
  reviewInstructions: string | null;
  returnAssignee: { type: string; id: string | null } | null;
  nextStage: { type: string; participants: { type: string; id: string | null }[] } | null;
  documents: { key: string; title: string; revision: number | null; revisionId: string | null; href: string }[];
  interactions: {
    id: string; continuation: string; status: string;
    target: { key: string; label: string | null; revision: number | null; revisionId: string | null } | null;
  }[];
  warnings: string[];
};
export type PaperclipArtifact = {
  id: string; title: string; source: string; preview: string | null;
  issueId: string; issueIdentifier: string; agentId: string | null;
  updatedAt: string | null; href: string;
};
export type PaperclipSnapshot = {
  fetchedAt: string;
  company: { id: string; name: string; prefix: string; href: string };
  links: { tasks: string; decisions: string; artifacts: string; agents: string };
  agents: PaperclipAgent[];
  tasks: PaperclipTask[];
  projects: { id: string; name: string }[];
  liveRuns: PaperclipRun[];
  liveAvailable: boolean;
  recentRuns: PaperclipRun[];
  attention: { available: boolean; total: number; items: PaperclipAttention[] };
  artifacts: PaperclipArtifact[];
  warnings: string[];
};

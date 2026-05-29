import type { ThinkingLevel as AiThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession, ContextUsage } from "@earendil-works/pi-coding-agent";

export type SessionThinkingLevel = "off" | AiThinkingLevel;
export type SubagentStatus =
  | "starting"
  | "running"
  | "waiting for feedback"
  | "completed"
  | "failed"
  | "stopped";

export type FeedbackRequest = {
  id: string;
  question: string;
  context?: string;
  requestedAt: number;
  resolve: (feedback: string) => void;
  cancel: (reason: string) => void;
};

export type FeedbackRequestDetails = {
  requestId: string;
  subagentId: string;
  status: "answered" | "cancelled";
};

export type StartSubagentDetails = {
  subagentId?: string;
  name?: string;
  role?: string;
  cwd?: string;
  task?: string;
  status: SubagentStatus | "error";
  command?: string;
  availableRoles?: string[];
  activity?: string;
  elapsed?: string;
  result?: string;
  error?: string;
};

export type SubagentControlDetails = {
  action: "stop" | "reply";
  status: "stopped" | "replied" | "noop" | "error";
  subagentId?: string;
  name?: string;
  cwd?: string;
  subagentStatus?: SubagentStatus;
  activity?: string;
  elapsed?: string;
  message?: string;
  error?: string;
};

export type RoleModelSpec = {
  provider: string;
  modelId: string;
  label: string;
};

export type SubagentRole = {
  name: string;
  description: string;
  tools: string[];
  model?: RoleModelSpec;
  thinking?: SessionThinkingLevel;
  systemPrompt: string;
  filePath: string;
  source: "built-in" | "user";
  overridden?: boolean;
  autoExit?: boolean;
  output?: string;
};

export type SubagentRoleOverride = {
  model?: string;
  thinking?: string;
  tools?: string[] | string;
};

export type SubagentSettings = {
  agentOverrides?: Record<string, SubagentRoleOverride>;
};

export type SubagentRoleDiagnostic = {
  level: "warning" | "error";
  message: string;
  filePath?: string;
};

export type SubagentRoleLoadResult = {
  roles: SubagentRole[];
  diagnostics: SubagentRoleDiagnostic[];
};

export type ParsedStartArgs = {
  name: string;
  task: string;
  role?: SubagentRole;
  cwd?: string;
  notifyOnStart?: boolean;
  notifyOnCompletion?: boolean;
};

export type SubagentRecord = {
  id: string;
  name: string;
  task: string;
  cwd: string;
  role?: SubagentRole;
  status: SubagentStatus;
  startedAt: number;
  finishedAt?: number;
  activity: string;
  result?: string;
  error?: string;
  session?: AgentSession;
  unsubscribe?: () => void;
  contextUsage?: ContextUsage;
  pendingFeedback?: FeedbackRequest;
  feedbackSerial: number;
  toolCalls: Map<
    string,
    { name: string; startedAt: number; status: "running" | "done" | "failed" }
  >;
  completion?: Promise<void>;
  notifyOnCompletion: boolean;
};

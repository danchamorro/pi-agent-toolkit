import type { SessionThinkingLevel } from "./types.ts";

export const SUBAGENT_MESSAGE_TYPE = "subagent-status";
export const FEEDBACK_MESSAGE_TYPE = "subagent-feedback-request";
export const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
export const SUBAGENT_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
export const THINKING_LEVELS = new Set<SessionThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export const MAX_ACTIVITY_LENGTH = 220;
export const ROLE_AGENT_FILES = ["planner.md", "reviewer.md", "scout.md", "worker.md"] as const;

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

// Soft ceiling on simultaneously active sub-agents. Each active sub-agent is a
// full background model session, so this guards against runaway cost and
// provider rate limits. Override with `subagents.maxConcurrent` in settings.json.
export const DEFAULT_MAX_CONCURRENT = 5;

// Idle auto-stop is opt-in (0 disables it) so background work is never killed
// unless the user asks for it. Override with `subagents.idleTimeoutMinutes`.
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 0;

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { MAX_ACTIVITY_LENGTH } from "./constants.ts";
import type { SubagentRecord } from "./types.ts";

export function stripDynamicSystemPromptFooter(systemPrompt: string): string {
  return systemPrompt
    .replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
    .replace(/\nCurrent working directory:[^\n]*$/u, "")
    .trim();
}

export function singleLine(value: string, maxLength = MAX_ACTIVITY_LENGTH): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 3)}...` : line;
}

export function splitCommand(input: string): { command: string; rest: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { command: "view", rest: "" };
  }

  const firstSpace = trimmed.search(/\s/u);
  if (firstSpace === -1) {
    return { command: trimmed.toLowerCase(), rest: "" };
  }

  return {
    command: trimmed.slice(0, firstSpace).toLowerCase(),
    rest: trimmed.slice(firstSpace + 1).trim(),
  };
}

export function deriveName(task: string): string {
  const words = task
    .replace(/[^a-zA-Z0-9 _.-]+/g, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 5);
  return words.length > 0 ? words.join(" ") : "sub-agent";
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function elapsedFor(record: SubagentRecord): string {
  return formatDuration((record.finishedAt ?? Date.now()) - record.startedAt);
}

export function lastActivityFor(record: SubagentRecord): string {
  return formatDuration(Date.now() - record.lastActivityAt);
}

export function formatContextUsage(record: SubagentRecord): string {
  const usage = record.session?.getContextUsage() ?? record.contextUsage;
  if (!usage) {
    return "context unknown";
  }
  if (usage.tokens === null || usage.percent === null) {
    return `context ?/${usage.contextWindow}`;
  }
  return `context ${Math.round(usage.tokens)}/${usage.contextWindow} (${usage.percent.toFixed(1)}%)`;
}

export function extractText(parts: AssistantMessage["content"]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function extractEventAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const maybeMessage = message as { role?: unknown; content?: unknown };
  if (maybeMessage.role !== "assistant" || !Array.isArray(maybeMessage.content)) {
    return "";
  }

  return maybeMessage.content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function getLastAssistantMessage(session: AgentSession): AssistantMessage | null {
  for (let i = session.state.messages.length - 1; i >= 0; i--) {
    const message = session.state.messages[i];
    if (message.role === "assistant") {
      return message as AssistantMessage;
    }
  }

  return null;
}

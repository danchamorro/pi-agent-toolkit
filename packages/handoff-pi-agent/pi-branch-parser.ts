import type {
  HandoffKind,
  HandoffRole,
  HandoffSnapshot,
  NormalizedContentBlock,
  NormalizedSourceEntry,
} from "./shared/handoff/extractor-core.ts";

interface PiBranchSnapshotOptions {
  branch: unknown[];
  cwd: string;
  sessionFile?: string | null;
  sessionId?: string | null;
}

export function createPiBranchSnapshot(options: PiBranchSnapshotOptions): HandoffSnapshot {
  return {
    sourceAgent: "pi-agent",
    sessionId: options.sessionId ?? null,
    sessionFile: options.sessionFile ?? null,
    cwd: options.cwd,
    entries: options.branch
      .map(parseBranchEntry)
      .filter((entry): entry is NormalizedSourceEntry => entry !== null),
  };
}

function parseBranchEntry(entry: unknown): NormalizedSourceEntry | null {
  if (!isRecord(entry)) return unknownEntry("malformed-entry");

  if (entry.type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    const sourceRole = typeof message.role === "string" ? message.role : "unknown";
    return {
      role: portableRole(sourceRole),
      sourceRole,
      kind: "message",
      timestamp: readTimestamp(message, entry),
      sourceMessageId: readId(message, entry),
      content: parseMessageContent(sourceRole, message.content),
    };
  }

  const summary = readSummary(entry);
  if (summary) return summary;

  if (isKnownNonTranscriptEntry(entry.type)) return null;

  return unknownEntry(typeof entry.type === "string" ? entry.type : "unknown-entry");
}

function isKnownNonTranscriptEntry(type: unknown): boolean {
  return type === "model_change" || type === "thinking_level_change" || type === "session_info";
}

function readSummary(entry: Record<string, unknown>): NormalizedSourceEntry | null {
  const sourceRole = typeof entry.type === "string" ? entry.type : "context";
  const text = stringProperty(entry, ["summary", "content", "text"]);
  if (!text) return null;

  const kind: HandoffKind = sourceRole.toLowerCase().includes("compact")
    ? "compaction-summary"
    : sourceRole.toLowerCase().includes("branch")
      ? "branch-summary"
      : "custom-message";

  return {
    role: "context",
    sourceRole,
    kind,
    timestamp: readTimestamp(entry),
    sourceMessageId: readId(entry),
    content: text,
  };
}

function parseMessageContent(role: string, content: unknown): string | NormalizedContentBlock[] {
  if (isToolResultRole(role)) return [{ type: "tool_result" }];
  if (isToolCallRole(role)) return [{ type: "tool_call" }];
  return parseContent(content);
}

function parseContent(content: unknown): string | NormalizedContentBlock[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return [{ type: "unknown", label: "non-array-content" }];

  return content.map((block): NormalizedContentBlock => {
    if (typeof block === "string") return { type: "text", text: block };
    if (!isRecord(block)) return { type: "unknown", label: "malformed-content-block" };
    if (block.type === "text" && typeof block.text === "string")
      return { type: "text", text: block.text };
    if (isToolCall(block.type)) return { type: "tool_call" };
    if (isToolResult(block.type)) return { type: "tool_result" };
    if (isThinking(block.type)) return { type: "thinking" };
    return {
      type: "unknown",
      label: typeof block.type === "string" ? block.type : "unknown-content-block",
    };
  });
}

function portableRole(role: string): HandoffRole {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "other";
}

function isToolCall(type: unknown): boolean {
  return typeof type === "string" && isToolCallRole(type);
}

function isToolCallRole(role: string): boolean {
  return ["toolCall", "tool_call", "tool_use", "tool-use", "function_call"].includes(role);
}

function isToolResult(type: unknown): boolean {
  return typeof type === "string" && isToolResultRole(type);
}

function isToolResultRole(role: string): boolean {
  return [
    "toolResult",
    "tool_result",
    "tool_result_content",
    "tool-result",
    "function_result",
  ].includes(role);
}

function isThinking(type: unknown): boolean {
  return type === "thinking" || type === "reasoning" || type === "redacted_thinking";
}

function readTimestamp(...records: Record<string, unknown>[]): string | number | null {
  for (const record of records) {
    const value = record.timestamp ?? record.createdAt ?? record.created_at;
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function readId(...records: Record<string, unknown>[]): string | null {
  for (const record of records) {
    const value = record.id ?? record.messageId ?? record.message_id;
    if (typeof value === "string") return value;
  }
  return null;
}

function stringProperty(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function unknownEntry(label: string): NormalizedSourceEntry {
  return {
    role: "other",
    sourceRole: label,
    kind: "system-event",
    timestamp: null,
    sourceMessageId: null,
    content: [{ type: "unknown", label }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

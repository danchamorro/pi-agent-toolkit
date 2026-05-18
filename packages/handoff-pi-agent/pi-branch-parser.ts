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
    entries: options.branch.map(parseBranchEntry),
  };
}

function parseBranchEntry(entry: unknown): NormalizedSourceEntry {
  if (!isRecord(entry)) return unknownEntry("malformed-entry");

  if (entry.type === "message" && isRecord(entry.message)) {
    return parseMessageEntry(entry, entry.message);
  }

  if (entry.type === "custom_message") {
    return {
      role: "context",
      sourceRole: "custom_message",
      kind: "custom-message",
      timestamp: readTimestamp(entry),
      sourceMessageId: readId(entry),
      content: parseContent(entry.content),
    };
  }

  const summary = readSummary(entry);
  if (summary) return summary;

  if (isKnownNonContextEntry(entry.type)) {
    return omittedEntry(entry, typeof entry.type === "string" ? entry.type : "non-context-entry");
  }

  return unknownEntry(typeof entry.type === "string" ? entry.type : "unknown-entry");
}

function parseMessageEntry(
  entry: Record<string, unknown>,
  message: Record<string, unknown>,
): NormalizedSourceEntry {
  const sourceRole = typeof message.role === "string" ? message.role : "unknown";
  const base = {
    role: portableRole(sourceRole),
    sourceRole,
    timestamp: readTimestamp(message, entry),
    sourceMessageId: readId(message, entry),
  };

  if (isBashExecutionRole(sourceRole)) {
    return {
      ...base,
      role: "other",
      kind: "bash-execution",
      content: [
        {
          type: "bash_execution",
          command: stringValue(message.command),
          output: stringValue(message.output),
          exitCode: numberOrNullValue(message.exitCode),
          cancelled: booleanValue(message.cancelled),
          truncated: booleanValue(message.truncated),
          fullOutputPath: stringValue(message.fullOutputPath),
        },
      ],
    };
  }

  if (isToolResultRole(sourceRole)) {
    return {
      ...base,
      role: "other",
      kind: "tool-result",
      content: [
        {
          type: "tool_result",
          toolName: stringValue(message.toolName),
          toolCallId: stringValue(message.toolCallId),
          content: contentToText(message.content),
          isError: booleanValue(message.isError),
        },
      ],
    };
  }

  if (isToolCallRole(sourceRole)) {
    return {
      ...base,
      role: "other",
      kind: "tool-call",
      content: [
        {
          type: "tool_call",
          name: stringValue(message.name),
          arguments: message.arguments,
        },
      ],
    };
  }

  return {
    ...base,
    kind: "message",
    content: parseContent(message.content),
  };
}

function isKnownNonContextEntry(type: unknown): boolean {
  switch (type) {
    case "custom":
    case "label":
    case "model_change":
    case "thinking_level_change":
    case "session_info":
      return true;
    default:
      return false;
  }
}

function readSummary(entry: Record<string, unknown>): NormalizedSourceEntry | null {
  const sourceRole = typeof entry.type === "string" ? entry.type : "context";
  const text = stringProperty(entry, ["summary", "content", "text"]);
  if (!text) return null;

  return {
    role: "context",
    sourceRole,
    kind: summaryKindForSourceRole(sourceRole),
    timestamp: readTimestamp(entry),
    sourceMessageId: readId(entry),
    content: text,
  };
}

function summaryKindForSourceRole(sourceRole: string): HandoffKind {
  const normalizedSourceRole = sourceRole.toLowerCase();

  if (normalizedSourceRole.includes("compact")) return "compaction-summary";
  if (normalizedSourceRole.includes("branch")) return "branch-summary";
  return "custom-message";
}

function parseContent(content: unknown): string | NormalizedContentBlock[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return [{ type: "unknown", label: "non-array-content" }];

  return content.map(parseContentBlock);
}

function parseContentBlock(block: unknown): NormalizedContentBlock {
  if (typeof block === "string") return { type: "text", text: block };
  if (!isRecord(block)) return { type: "unknown", label: "malformed-content-block" };
  if (block.type === "text" && typeof block.text === "string") {
    return { type: "text", text: block.text };
  }
  if (block.type === "image") return { type: "text", text: imagePlaceholder(block) };
  if (isToolCall(block.type)) {
    return {
      type: "tool_call",
      name: stringValue(block.name),
      arguments: block.arguments,
    };
  }
  if (isToolResult(block.type)) {
    return {
      type: "tool_result",
      toolName: stringValue(block.toolName),
      toolCallId: stringValue(block.toolCallId),
      content: contentToText(block.content),
      isError: booleanValue(block.isError),
    };
  }
  if (isThinking(block.type)) return { type: "thinking" };
  return {
    type: "unknown",
    label: typeof block.type === "string" ? block.type : "unknown-content-block",
  };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyUnknownContent(content);

  const textParts: string[] = [];
  for (const block of content) {
    const textPart = contentBlockToTextPart(block);
    if (textPart !== null) textParts.push(textPart);
  }

  return textParts.filter((part) => part.trim()).join("\n");
}

function contentBlockToTextPart(block: unknown): string | null {
  if (typeof block === "string") return block;
  if (!isRecord(block)) return stringifyUnknownContent(block);
  if (block.type === "text" && typeof block.text === "string") return block.text;
  if (block.type === "image") return imagePlaceholder(block);
  if (isThinking(block.type)) return null;
  return stringifyUnknownContent(block);
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

function isBashExecutionRole(role: string): boolean {
  return role === "bashExecution" || role === "bash_execution";
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

function omittedEntry(entry: Record<string, unknown>, label: string): NormalizedSourceEntry {
  return {
    role: "other",
    sourceRole: label,
    kind: "system-event",
    timestamp: readTimestamp(entry),
    sourceMessageId: readId(entry),
    content: [{ type: "omitted", label }],
  };
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

function imagePlaceholder(block: Record<string, unknown>): string {
  const mediaType = stringValue(block.mediaType) ?? stringValue(block.mimeType) ?? "unknown";
  return `[image content preserved as placeholder: ${mediaType}]`;
}

function stringifyUnknownContent(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable content]";
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrNullValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

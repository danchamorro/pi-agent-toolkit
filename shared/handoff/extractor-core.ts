export type SourceAgent = "pi-agent" | "claude-code";
export type HandoffRole = "user" | "assistant" | "context" | "system" | "other";
export type HandoffKind =
  | "message"
  | "tool-call"
  | "tool-result"
  | "bash-execution"
  | "compaction-summary"
  | "branch-summary"
  | "custom-message"
  | "system-event";
export type AddGitignoreMode = true | false | "ask";
export type BriefingSource = "deterministic" | "model";

export interface HandoffBriefing {
  generated_by: BriefingSource;
  content: string;
  model: string | null;
}

export interface HandoffMessage {
  index: number;
  role: HandoffRole;
  source_role: string;
  kind: HandoffKind;
  timestamp: string | null;
  source_message_id: string | null;
  content: string;
}

export interface HandoffArtifact {
  handoff_version: 2;
  mode: "continuity-packet";
  source: {
    agent: SourceAgent;
    session_id: string | null;
    session_file: string | null;
    cwd: string;
    generated_at: string;
  };
  output: {
    directory: string;
    json_file: string;
    markdown_file: string;
  };
  policy: {
    thinking_traces_removed: true;
    tool_calls_preserved: true;
    tool_results_preserved: true;
    command_output_preserved: true;
    extension_state_removed: true;
  };
  briefing: HandoffBriefing;
  stats: HandoffStats;
  messages: HandoffMessage[];
  warnings: string[];
}

export interface HandoffStats {
  source_entries_seen: number;
  messages_written: number;
  omitted_empty_messages: number;
  omitted_non_context_entries: number;
  tool_calls_preserved: number;
  tool_results_preserved: number;
  bash_executions_preserved: number;
  thinking_blocks_removed: number;
  unknown_entries_seen: number;
}

export interface NormalizedTextBlock {
  type: "text";
  text: string;
}

export interface NormalizedThinkingBlock {
  type: "thinking";
}

export interface NormalizedToolCallBlock {
  type: "tool_call";
  name?: string;
  arguments?: unknown;
}

export interface NormalizedToolResultBlock {
  type: "tool_result";
  toolName?: string;
  toolCallId?: string;
  content?: string;
  isError?: boolean;
}

export interface NormalizedBashExecutionBlock {
  type: "bash_execution";
  command?: string;
  output?: string;
  exitCode?: number | null;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
}

export interface NormalizedOmittedBlock {
  type: "omitted";
  label: string;
}

export interface NormalizedUnknownBlock {
  type: "unknown";
  label?: string;
}

export type NormalizedContentBlock =
  | NormalizedTextBlock
  | NormalizedThinkingBlock
  | NormalizedToolCallBlock
  | NormalizedToolResultBlock
  | NormalizedBashExecutionBlock
  | NormalizedOmittedBlock
  | NormalizedUnknownBlock;

export interface NormalizedSourceEntry {
  role: HandoffRole;
  sourceRole: string;
  kind?: HandoffKind;
  timestamp?: string | number | null;
  sourceMessageId?: string | null;
  content: string | NormalizedContentBlock[];
}

export interface HandoffSnapshot {
  sourceAgent: SourceAgent;
  sessionId?: string | null;
  sessionFile?: string | null;
  cwd: string;
  entries: NormalizedSourceEntry[];
}

export interface CreateHandoffOptions {
  generatedAt?: string;
  outputDirectory?: string;
  jsonFile?: string;
  markdownFile?: string;
  strict?: boolean;
  briefing?: HandoffBriefing;
}

export function createEmptyStats(): HandoffStats {
  return {
    source_entries_seen: 0,
    messages_written: 0,
    omitted_empty_messages: 0,
    omitted_non_context_entries: 0,
    tool_calls_preserved: 0,
    tool_results_preserved: 0,
    bash_executions_preserved: 0,
    thinking_blocks_removed: 0,
    unknown_entries_seen: 0,
  };
}

export function createHandoffArtifact(
  snapshot: HandoffSnapshot,
  options: CreateHandoffOptions = {},
): HandoffArtifact {
  const stats = createEmptyStats();
  const warnings: string[] = [];
  const messages: HandoffMessage[] = [];

  for (const entry of snapshot.entries) {
    stats.source_entries_seen += 1;
    const content = cleanContent(entry.content, stats, warnings, options.strict === true);
    if (!content.trim()) {
      stats.omitted_empty_messages += 1;
      continue;
    }

    messages.push({
      index: messages.length + 1,
      role: entry.role,
      source_role: entry.sourceRole,
      kind: entry.kind ?? "message",
      timestamp: normalizeTimestamp(entry.timestamp ?? null),
      source_message_id: entry.sourceMessageId ?? null,
      content,
    });
  }

  stats.messages_written = messages.length;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const directory =
    options.outputDirectory ??
    `.handoffs/${formatHandoffDirectoryName(generatedAt, snapshot.sourceAgent)}`;

  const handoffWithoutBriefing = {
    handoff_version: 2 as const,
    mode: "continuity-packet" as const,
    source: {
      agent: snapshot.sourceAgent,
      session_id: snapshot.sessionId ?? null,
      session_file: snapshot.sessionFile ?? null,
      cwd: snapshot.cwd,
      generated_at: generatedAt,
    },
    output: {
      directory,
      json_file: options.jsonFile ?? `${directory}/handoff.json`,
      markdown_file: options.markdownFile ?? `${directory}/handoff.md`,
    },
    policy: {
      thinking_traces_removed: true as const,
      tool_calls_preserved: true as const,
      tool_results_preserved: true as const,
      command_output_preserved: true as const,
      extension_state_removed: true as const,
    },
    briefing: {
      generated_by: "deterministic" as const,
      content: "",
      model: null,
    },
    stats,
    messages,
    warnings,
  } satisfies HandoffArtifact;

  return {
    ...handoffWithoutBriefing,
    briefing: options.briefing ?? createDeterministicBriefing(handoffWithoutBriefing),
  };
}

export function cleanContent(
  content: string | NormalizedContentBlock[],
  stats: HandoffStats,
  warnings: string[],
  strict = false,
): string {
  if (typeof content === "string") return content;

  const textParts: string[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        textParts.push(block.text);
        break;
      case "tool_call":
        stats.tool_calls_preserved += 1;
        textParts.push(formatToolCall(block));
        break;
      case "tool_result":
        stats.tool_results_preserved += 1;
        textParts.push(formatToolResult(block));
        break;
      case "bash_execution":
        stats.bash_executions_preserved += 1;
        textParts.push(formatBashExecution(block));
        break;
      case "thinking":
        stats.thinking_blocks_removed += 1;
        break;
      case "omitted":
        stats.omitted_non_context_entries += 1;
        break;
      case "unknown": {
        stats.unknown_entries_seen += 1;
        const warning = `Unknown content block${block.label ? `: ${block.label}` : ""}`;
        if (strict) throw new Error(warning);
        warnings.push(warning);
        break;
      }
    }
  }

  return textParts.filter((part) => part.trim()).join("\n\n");
}

export function createDeterministicBriefing(handoff: HandoffArtifact): HandoffBriefing {
  const lastUser = findLastMessageContent(handoff.messages, "user");
  const lastAssistant = findLastMessageContent(handoff.messages, "assistant");
  const contextCount = handoff.messages.filter((message) => message.role === "context").length;
  const toolResults = handoff.messages.filter((message) => message.kind === "tool-result");
  const bashCommands = collectCommandLines(handoff.messages);
  const readPaths = collectToolArgumentValues(handoff.messages, "read", "path");
  const editedPaths = [
    ...collectToolArgumentValues(handoff.messages, "edit", "path"),
    ...collectToolArgumentValues(handoff.messages, "write", "path"),
  ];
  const validationCommands = bashCommands.filter(isLikelyValidationCommand);

  return {
    generated_by: "deterministic",
    model: null,
    content: [
      "## Current Status",
      "",
      trimOrFallback(lastAssistant, "Review the timeline below for the latest assistant status."),
      "",
      "## Recent User Request",
      "",
      trimOrFallback(lastUser, "No user request was found in the exported branch."),
      "",
      "## Evidence Summary",
      "",
      `- Timeline messages: ${handoff.messages.length}`,
      `- Context records: ${contextCount}`,
      `- Tool calls preserved: ${handoff.stats.tool_calls_preserved}`,
      `- Tool results preserved: ${toolResults.length}`,
      `- Bash executions preserved: ${handoff.stats.bash_executions_preserved}`,
      ...formatListSection("Files read", readPaths),
      ...formatListSection("Files edited or written", editedPaths),
      ...formatListSection("Validation commands", validationCommands),
      "",
      "## Next Step",
      "",
      "Continue from the recent user request and current status. Inspect the timeline entries for supporting evidence when needed.",
    ].join("\n"),
  };
}

export function normalizeTimestamp(value: string | number | null): string | null {
  if (value === null) return null;
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function formatHandoffDirectoryName(isoTimestamp: string, agent: SourceAgent): string {
  const parsed = new Date(isoTimestamp);
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const timestamp = safe.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `${timestamp}-${agent}`;
}

export function assertHandoffArtifact(value: HandoffArtifact): void {
  if (value.handoff_version !== 2) throw new Error("Unsupported handoff_version");
  if (value.mode !== "continuity-packet") throw new Error("Unsupported handoff mode");
  if (!value.briefing.content.trim()) throw new Error("Handoff briefing is empty");
  for (const message of value.messages) {
    if (!message.content.trim()) throw new Error(`Message ${message.index} has empty content`);
  }
}

function formatToolCall(block: NormalizedToolCallBlock): string {
  const lines = ["[tool_call]", `name: ${block.name ?? "unknown"}`];
  if (block.arguments !== undefined) lines.push(`arguments: ${safeJson(block.arguments)}`);
  return lines.join("\n");
}

function formatToolResult(block: NormalizedToolResultBlock): string {
  const lines = ["[tool_result]"];
  if (block.toolName) lines.push(`tool: ${block.toolName}`);
  if (block.toolCallId) lines.push(`tool_call_id: ${block.toolCallId}`);
  if (block.isError !== undefined) lines.push(`is_error: ${String(block.isError)}`);
  if (block.content?.trim()) lines.push("output:", block.content);
  return lines.join("\n");
}

function formatBashExecution(block: NormalizedBashExecutionBlock): string {
  const lines = ["[bash_execution]"];
  if (block.command) lines.push(`command: ${block.command}`);
  if (block.exitCode !== undefined) lines.push(`exit_code: ${String(block.exitCode)}`);
  if (block.cancelled !== undefined) lines.push(`cancelled: ${String(block.cancelled)}`);
  if (block.truncated !== undefined) lines.push(`truncated: ${String(block.truncated)}`);
  if (block.fullOutputPath) lines.push(`full_output_path: ${block.fullOutputPath}`);
  if (block.output?.trim()) lines.push("output:", block.output);
  return lines.join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function findLastMessageContent(messages: HandoffMessage[], role: HandoffRole): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === role && message.content.trim()) return message.content.trim();
  }
  return null;
}

function trimOrFallback(value: string | null, fallback: string): string {
  if (!value?.trim()) return fallback;

  const normalized = value.trim();
  if (normalized.length <= 2000) return normalized;

  return `${normalized.slice(0, 2000)}\n\n[truncated in briefing]`;
}

function collectCommandLines(messages: HandoffMessage[]): string[] {
  const commands = new Set<string>();
  for (const message of messages) {
    for (const line of message.content.split("\n")) {
      if (line.startsWith("command: ")) commands.add(line.slice("command: ".length));
      if (line.includes('"command":')) {
        const command = extractJsonStringProperty(line, "command");
        if (command) commands.add(command);
      }
    }
  }
  return [...commands];
}

function collectToolArgumentValues(
  messages: HandoffMessage[],
  toolName: string,
  property: string,
): string[] {
  const values = new Set<string>();
  for (const message of messages) {
    if (!message.content.includes(`[tool_call]\nname: ${toolName}`)) continue;
    for (const line of message.content.split("\n")) {
      if (!line.startsWith("arguments: ")) continue;
      const value = extractJsonStringProperty(line.slice("arguments: ".length), property);
      if (value) values.add(value);
    }
  }
  return [...values];
}

function extractJsonStringProperty(jsonText: string, property: string): string | null {
  try {
    const value = JSON.parse(jsonText) as unknown;
    if (!isRecord(value)) return null;
    const propertyValue = value[property];
    return typeof propertyValue === "string" ? propertyValue : null;
  } catch {
    return null;
  }
}

function isLikelyValidationCommand(command: string): boolean {
  return /\b(test|verify|lint|typecheck|build|format:check|npm pack|pnpm pack)\b/.test(command);
}

function formatListSection(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [`- ${label}:`, ...values.slice(0, 12).map((value) => `  - ${value}`)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

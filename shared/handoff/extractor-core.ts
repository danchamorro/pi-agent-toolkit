export type SourceAgent = "pi-agent" | "claude-code";
export type HandoffRole = "user" | "assistant" | "context" | "system" | "other";
export type HandoffKind =
  | "message"
  | "compaction-summary"
  | "branch-summary"
  | "custom-message"
  | "system-event";
export type AddGitignoreMode = true | false | "ask";

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
  handoff_version: 1;
  mode: "verbatim-clean-transcript";
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
  stripped: {
    tool_calls: true;
    tool_results: true;
    thinking: true;
  };
  stats: HandoffStats;
  messages: HandoffMessage[];
  warnings: string[];
}

export interface HandoffStats {
  source_entries_seen: number;
  messages_written: number;
  omitted_empty_messages: number;
  tool_calls_removed: number;
  tool_results_removed: number;
  thinking_blocks_removed: number;
}

export interface NormalizedTextBlock {
  type: "text";
  text: string;
}

export interface NormalizedStripBlock {
  type: "tool_call" | "tool_result" | "thinking";
}

export interface NormalizedUnknownBlock {
  type: "unknown";
  label?: string;
}

export type NormalizedContentBlock =
  | NormalizedTextBlock
  | NormalizedStripBlock
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
}

export function createEmptyStats(): HandoffStats {
  return {
    source_entries_seen: 0,
    messages_written: 0,
    omitted_empty_messages: 0,
    tool_calls_removed: 0,
    tool_results_removed: 0,
    thinking_blocks_removed: 0,
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

  return {
    handoff_version: 1,
    mode: "verbatim-clean-transcript",
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
    stripped: {
      tool_calls: true,
      tool_results: true,
      thinking: true,
    },
    stats,
    messages,
    warnings,
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
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_call") {
      stats.tool_calls_removed += 1;
    } else if (block.type === "tool_result") {
      stats.tool_results_removed += 1;
    } else if (block.type === "thinking") {
      stats.thinking_blocks_removed += 1;
    } else if (block.type === "unknown") {
      const warning = `Unknown content block${block.label ? `: ${block.label}` : ""}`;
      if (strict) throw new Error(warning);
      warnings.push(warning);
    }
  }

  return textParts.join("\n");
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
  if (value.handoff_version !== 1) throw new Error("Unsupported handoff_version");
  if (value.mode !== "verbatim-clean-transcript") throw new Error("Unsupported handoff mode");
  for (const message of value.messages) {
    if (!message.content.trim()) throw new Error(`Message ${message.index} has empty content`);
  }
}

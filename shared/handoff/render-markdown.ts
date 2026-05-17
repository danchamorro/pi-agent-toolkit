import type { HandoffArtifact } from "./extractor-core.ts";

export function renderHandoffMarkdown(handoff: HandoffArtifact): string {
  const warnings = handoff.warnings.length
    ? handoff.warnings.map((warning) => `- ${warning}`).join("\n")
    : "None.";
  const messages = handoff.messages
    .map((message) =>
      [`### ${message.index}. ${message.role} (${message.kind})`, "", message.content].join("\n"),
    )
    .join("\n\n");

  return [
    "# Handoff Export",
    "",
    "This Markdown file is for human review. The canonical artifact for receiving agents is `handoff.json`.",
    "",
    "## Human Review Notes",
    "",
    "Review this file for private prompts, local paths, code snippets, or business context before sharing.",
    "",
    "## Source",
    "",
    `- Agent: ${handoff.source.agent}`,
    `- Session ID: ${handoff.source.session_id ?? "null"}`,
    `- Session file: ${handoff.source.session_file ?? "null"}`,
    `- CWD: ${handoff.source.cwd}`,
    `- Generated at: ${handoff.source.generated_at}`,
    "",
    "## Stripping Policy",
    "",
    "Tool calls, tool results, shell output, MCP output, and thinking blocks are stripped. Empty messages left after stripping are omitted.",
    "",
    "## Stats",
    "",
    ...Object.entries(handoff.stats).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Warnings",
    "",
    warnings,
    "",
    "## Transcript Preview",
    "",
    messages || "No messages written.",
    "",
  ].join("\n");
}

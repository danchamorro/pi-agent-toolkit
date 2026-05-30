import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { elapsedFor, formatContextUsage } from "./format.ts";
import { formatPathForDisplay } from "./paths.ts";
import type { SubagentRecord, SubagentRole, SubagentRoleDiagnostic } from "./types.ts";

type Capability = "read" | "shell" | "write" | "feedback" | "review";
type Theme = ExtensionContext["ui"]["theme"];

type RoleSummary = {
  name: string;
  intent: string;
  guidance: string;
  capabilities: Capability[];
  model: string;
  thinking: string;
  detailCommand: string;
  startCommand: string;
  sourceLabel: string;
  tools: string[];
};

const ROLE_GUIDANCE: Record<string, string> = {
  planner: "Use when scope, sequencing, or trade-offs are unclear.",
  reviewer: "Use after changes exist and need correctness, security, or validation review.",
  scout: "Use first when you need fast read-only codebase reconnaissance.",
  worker: "Use when the task is scoped and ready for implementation.",
};

const WORKFLOW_ORDER = ["scout", "planner", "worker", "reviewer"];

export function formatRecordChoices(recordsToFormat: SubagentRecord[]): string {
  return recordsToFormat
    .map((record) => `${record.id} ${record.name} (${record.status})`)
    .join(", ");
}

export function formatSubagentList(records: SubagentRecord[], theme?: Theme): string {
  if (records.length === 0) {
    return "No sub-agents yet. Start one with `/subagent start <task>` or `/subagent start <role> <task>`.";
  }

  const waiting = records.filter((record) => record.pendingFeedback);
  const running = records.filter(
    (record) => ["starting", "running"].includes(record.status) && !record.pendingFeedback,
  );
  const recent = records.filter(
    (record) => !record.pendingFeedback && !["starting", "running"].includes(record.status),
  );
  const activeCount = waiting.length + running.length;
  const lines = [heading(`Subagents (${activeCount} active, ${recent.length} recent)`, theme)];

  if (waiting.length > 0) {
    lines.push("", sectionHeading("Needs feedback", "warning", theme));
    for (const record of waiting) {
      lines.push(
        `  ${strong(record.id, theme)} ${strong(record.name, theme)} ${muted(`(${record.role?.name ?? "ad hoc"})`, theme)}`,
      );
      lines.push(
        `    ${label("asks", theme)} ${record.pendingFeedback?.question ?? "Feedback requested."}`,
      );
      lines.push(
        `    ${label("reply", theme)} ${command(`/subagent reply ${record.id} <feedback>`, theme)}`,
      );
    }
  }

  if (running.length > 0) {
    lines.push("", sectionHeading("Running", "accent", theme));
    for (const record of running) {
      lines.push(formatRecordStatusLine(record, theme));
      lines.push(`    ${label("latest", theme)} ${muted(record.activity, theme)}`);
    }
  }

  if (recent.length > 0) {
    lines.push("", sectionHeading("Recent", "dim", theme));
    for (const record of recent) {
      lines.push(formatRecordStatusLine(record, theme));
    }
  }

  lines.push(
    "",
    `${label("Inspect", theme)} ${command("/subagent view <id>", theme)}   ${label("Stop", theme)} ${command("/subagent stop <id>", theme)}`,
  );
  return lines.join("\n");
}

export function formatRoleList(roles: SubagentRole[], theme?: Theme): string {
  const summaries = roles.map(summarizeRole).sort(compareRoleSummaries);
  const lines = [
    heading("Available sub-agent roles", theme),
    `${muted("Choose by intent. Exact tools and source details are in `", theme)}${command("/subagent view <role>", theme)}${muted("`.", theme)}`,
  ];

  for (const summary of summaries) {
    lines.push("", roleName(summary.name, theme));
    lines.push(`  ${summary.intent}`);
    lines.push(`  ${muted(summary.guidance, theme)}`);
    lines.push(
      `  ${label("capabilities", theme)} ${formatCapabilities(summary.capabilities, theme)}   ${label("model", theme)} ${muted(summary.model, theme)}   ${label("thinking", theme)} ${thinking(summary.thinking, theme)}`,
    );
    lines.push(
      `  ${label("start", theme)} ${command(summary.startCommand, theme)}   ${label("details", theme)} ${command(summary.detailCommand, theme)}`,
    );
  }

  return lines.join("\n");
}

export function formatRoleDetails(role: SubagentRole, theme?: Theme): string {
  const summary = summarizeRole(role);
  return [
    `${heading("Sub-agent role:", theme)} ${roleName(summary.name, theme)}`,
    `${label("Use when", theme)} ${summary.guidance}`,
    `${label("Description", theme)} ${summary.intent}`,
    `${label("Capabilities", theme)} ${formatCapabilities(summary.capabilities, theme)}`,
    `${label("Tools", theme)} ${muted(summary.tools.join(", "), theme)}`,
    `${label("Model", theme)} ${muted(summary.model, theme)}`,
    `${label("Thinking", theme)} ${thinking(summary.thinking, theme)}`,
    `${label("Source", theme)} ${muted(summary.sourceLabel, theme)}`,
    `${label("Start", theme)} ${command(summary.startCommand, theme)}`,
  ].join("\n");
}

export function formatRoleDiagnostics(diagnostics: SubagentRoleDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }

  return [
    "Sub-agent role warnings:",
    ...diagnostics.map((diagnostic) => {
      const location = diagnostic.filePath ? ` (${diagnostic.filePath})` : "";
      return `- ${diagnostic.message}${location}`;
    }),
  ].join("\n");
}

export function formatRecordDetails(record: SubagentRecord): string {
  const lines = [
    `Sub-agent ${record.id}: ${record.name}`,
    record.role ? `Role: ${record.role.name}` : undefined,
    `Cwd: ${record.cwd}`,
    `Status: ${record.status}`,
    `Elapsed: ${elapsedFor(record)}`,
    `Context: ${formatContextUsage(record)}`,
    `Task: ${record.task}`,
    `Latest: ${record.activity}`,
  ].filter(Boolean) as string[];

  if (record.pendingFeedback) {
    lines.push(`Waiting for feedback: ${record.pendingFeedback.question}`);
    lines.push(`Reply: /subagent reply ${record.id} <feedback>`);
  }
  if (record.result) {
    lines.push(`Result: ${record.result}`);
  }
  if (record.error) {
    lines.push(`Error: ${record.error}`);
  }

  return lines.join("\n");
}

function summarizeRole(role: SubagentRole): RoleSummary {
  const tools = [...new Set([...role.tools, "ask_main_session"])];
  const source = role.source === "user" ? "custom" : "built-in";
  return {
    name: role.name,
    intent: role.description || "No description",
    guidance:
      ROLE_GUIDANCE[role.name] ??
      "Use when this custom role matches the task better than a built-in role.",
    capabilities: capabilitiesForTools(tools),
    model: role.model?.label ?? "current model",
    thinking: role.thinking ?? "current thinking",
    detailCommand: `/subagent view ${role.name}`,
    startCommand: `/subagent start ${role.name} <task>`,
    sourceLabel: role.overridden ? `${source}, overridden` : source,
    tools,
  };
}

function compareRoleSummaries(left: RoleSummary, right: RoleSummary): number {
  const leftIndex = WORKFLOW_ORDER.indexOf(left.name);
  const rightIndex = WORKFLOW_ORDER.indexOf(right.name);
  if (leftIndex !== -1 || rightIndex !== -1) {
    return (
      (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  }
  return left.name.localeCompare(right.name);
}

function capabilitiesForTools(tools: string[]): Capability[] {
  const toolSet = new Set(tools);
  const capabilities: Capability[] = [];
  if (["read", "grep", "find", "ls"].some((tool) => toolSet.has(tool))) {
    capabilities.push("read");
  }
  if (toolSet.has("bash")) {
    capabilities.push("shell");
  }
  if (["edit", "write"].some((tool) => toolSet.has(tool))) {
    capabilities.push("write");
  }
  if (toolSet.has("ask_main_session")) {
    capabilities.push("feedback");
  }
  if (tools.some((tool) => tool.includes("review"))) {
    capabilities.push("review");
  }
  return capabilities;
}

function formatRecordStatusLine(record: SubagentRecord, theme?: Theme): string {
  return [
    `  ${strong(record.id, theme)} ${strong(record.name, theme)}`,
    `${label("role", theme)} ${muted(record.role?.name ?? "ad hoc", theme)}`,
    `${label("status", theme)} ${status(record.status, theme)}`,
    `${label("elapsed", theme)} ${muted(elapsedFor(record), theme)}`,
    muted(formatContextUsage(record), theme),
    `${label("cwd", theme)} ${muted(formatPathForDisplay(record.cwd), theme)}`,
  ].join("   ");
}

function formatCapabilities(capabilities: Capability[], theme?: Theme): string {
  return capabilities.map((capability) => capabilityBadge(capability, theme)).join(" ");
}

function capabilityBadge(capability: Capability, theme?: Theme): string {
  const text = `[${capability}]`;
  if (!theme) {
    return capability;
  }
  switch (capability) {
    case "write":
    case "shell":
      return theme.fg("warning", text);
    case "feedback":
    case "review":
      return theme.fg("accent", text);
    case "read":
      return theme.fg("success", text);
  }
}

function status(value: string, theme?: Theme): string {
  if (!theme) {
    return value;
  }
  switch (value) {
    case "completed":
      return theme.fg("success", value);
    case "failed":
      return theme.fg("error", value);
    case "waiting for feedback":
    case "stopped":
      return theme.fg("warning", value);
    default:
      return theme.fg("accent", value);
  }
}

function thinking(value: string, theme?: Theme): string {
  if (!theme) {
    return value;
  }
  return value === "off" ? theme.fg("dim", value) : theme.fg("warning", value);
}

function command(value: string, theme?: Theme): string {
  return theme ? theme.fg("accent", value) : value;
}

function heading(value: string, theme?: Theme): string {
  return theme ? theme.fg("accent", theme.bold(value)) : value;
}

function label(value: string, theme?: Theme): string {
  return theme ? theme.fg("muted", `${value}:`) : `${value}:`;
}

function muted(value: string, theme?: Theme): string {
  return theme ? theme.fg("dim", value) : value;
}

function roleName(value: string, theme?: Theme): string {
  return theme ? theme.fg("accent", theme.bold(value)) : value;
}

function sectionHeading(value: string, color: "accent" | "dim" | "warning", theme?: Theme): string {
  return theme ? theme.fg(color, theme.bold(value)) : value;
}

function strong(value: string, theme?: Theme): string {
  return theme ? theme.bold(value) : value;
}

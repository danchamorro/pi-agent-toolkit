import { elapsedFor, formatContextUsage } from "./format.ts";
import { formatPathForDisplay } from "./paths.ts";
import type { SubagentRecord, SubagentRole } from "./types.ts";

export function formatRecordChoices(recordsToFormat: SubagentRecord[]): string {
  return recordsToFormat
    .map((record) => `${record.id} ${record.name} (${record.status})`)
    .join(", ");
}

export function formatSubagentList(records: SubagentRecord[]): string {
  if (records.length === 0) {
    return "No sub-agents yet. Start one with `/subagent start <task>` or `/subagent start <role> <task>`.";
  }

  return records
    .map((record) => {
      const bits = [
        `${record.id} ${record.name}`,
        record.role ? `role: ${record.role.name}` : undefined,
        `cwd: ${formatPathForDisplay(record.cwd)}`,
        `status: ${record.status}`,
        `elapsed: ${elapsedFor(record)}`,
        formatContextUsage(record),
        `latest: ${record.activity}`,
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");
}

export function formatRoleList(roles: SubagentRole[]): string {
  return roles
    .map((role) => {
      const tools = [...new Set([...role.tools, "ask_main_session"])].join(", ");
      const model = role.model?.label ?? "current model";
      const thinking = role.thinking ?? "current thinking";
      return `- ${role.name}: ${role.description || "No description"} | tools: ${tools} | model: ${model} | thinking: ${thinking}`;
    })
    .join("\n");
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

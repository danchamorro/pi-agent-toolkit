import { singleLine } from "./format.ts";
import { formatPathForDisplay } from "./paths.ts";
import { renderBoxTable } from "./terminal-layout.ts";
import type { StartSubagentDetails, SubagentControlDetails } from "./types.ts";

export function formatStartSubagentCall(args: {
  role?: string;
  task?: string;
  name?: string;
  cwd?: string;
}): string {
  const role = args.role?.trim() || "default";
  const name = args.name?.trim();
  const displayName = name ? ` · ${singleLine(name, 42)}` : "";
  return `start_subagent ${role}${displayName}`;
}

export function formatStartSubagentSummary(details: StartSubagentDetails): string {
  if (details.status === "error") {
    return `start_subagent error: ${details.error ?? "unknown error"}`;
  }

  const id = details.subagentId ?? "?";
  return `${id} started`;
}

export function formatStartSubagentExpanded(
  details: StartSubagentDetails,
  contentText: string,
): string {
  const rows = [launchRow(details)];
  const extra = contentText.trim();
  return [
    launchTable(details.status === "error" ? "start_subagent error" : "subagent launch", rows),
    extra ? `\n${extra}` : "",
  ].join("");
}

export function formatControlSummary(details: SubagentControlDetails): string {
  if (details.status === "error") {
    return `${details.action}_subagent error: ${details.error ?? "unknown error"}`;
  }
  if (details.status === "noop") {
    return details.message ?? `${details.action}_subagent no-op`;
  }

  const id = details.subagentId ?? "?";
  const name = details.name ?? "sub-agent";
  const cwd = details.cwd ? ` | cwd ${formatPathForDisplay(details.cwd)}` : "";
  const status = details.subagentStatus ? ` | ${details.subagentStatus}` : "";
  return `${details.action}_subagent ${name} (${id}) ${details.status}${cwd}${status}`;
}

export function formatControlExpanded(
  details: SubagentControlDetails,
  contentText: string,
): string {
  const lines = [
    formatControlSummary(details),
    details.message,
    details.cwd ? `Cwd: ${details.cwd}` : "",
    details.activity ? `Latest: ${details.activity}` : "",
    details.elapsed ? `Elapsed: ${details.elapsed}` : "",
  ].filter(Boolean);

  if (contentText.trim() && contentText.trim() !== details.message?.trim()) {
    lines.push("", contentText.trim());
  }

  return lines.join("\n");
}

export function formatStopSubagentCall(args: { id?: string; reason?: string }): string {
  const id = args.id?.trim() || "active";
  const reason = args.reason?.trim();
  return `stop_subagent ${id}${reason ? `: ${singleLine(reason, 100)}` : ""}`;
}

export function formatReplySubagentCall(args: { id?: string; feedback?: string }): string {
  const id = args.id?.trim() || "waiting";
  const feedback = args.feedback?.trim() || "(no feedback)";
  return `reply_subagent ${id}: ${singleLine(feedback, 120)}`;
}

function launchTable(title: string, rows: string[][]): string {
  return renderBoxTable(["ID", "ROLE", "STATUS", "TASK / NEXT"], rows, [8, 16, 14, 78], {
    title,
    rowDividers: false,
    cellWrap: "truncate",
  });
}

function launchRow(details: StartSubagentDetails): string[] {
  const id = details.subagentId ?? "?";
  const role = details.role ?? "ad hoc";
  const command = details.command ?? "";
  const task = details.task ? singleLine(details.task, 120) : (details.name ?? "sub-agent");
  return [id, role, details.status, command ? `${task}\n${command}` : task];
}

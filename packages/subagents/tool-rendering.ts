import { singleLine } from "./format.ts";
import { formatPathForDisplay } from "./paths.ts";
import type { StartSubagentDetails, SubagentControlDetails } from "./types.ts";

export function formatStartSubagentCall(args: {
  role?: string;
  task?: string;
  name?: string;
  cwd?: string;
}): string {
  const role = args.role?.trim() || "default";
  const name = args.name?.trim();
  const cwd = args.cwd?.trim();
  const task = args.task?.trim() || "(no task)";
  return `start_subagent ${role}${name ? ` ${name}` : ""}${cwd ? ` cwd=${singleLine(cwd, 60)}` : ""}: ${singleLine(task, 120)}`;
}

export function formatStartSubagentSummary(details: StartSubagentDetails): string {
  if (details.status === "error") {
    return `start_subagent error: ${details.error ?? "unknown error"}`;
  }

  const id = details.subagentId ?? "?";
  const name = details.name ?? "sub-agent";
  const cwd = details.cwd ? ` | cwd ${formatPathForDisplay(details.cwd)}` : "";
  const task = details.task ? ` | ${singleLine(details.task, 100)}` : "";
  return `${name} (${id}) ${details.status}${details.elapsed ? ` in ${details.elapsed}` : ""}${cwd}${task}`;
}

export function formatStartSubagentExpanded(
  details: StartSubagentDetails,
  contentText: string,
): string {
  const lines = [
    formatStartSubagentSummary(details),
    details.command ? `Inspect: ${details.command}` : "",
    details.cwd ? `Cwd: ${details.cwd}` : "",
    details.activity ? `Latest: ${details.activity}` : "",
  ].filter(Boolean);

  if (contentText.trim()) {
    lines.push("", contentText.trim());
  }

  return lines.join("\n");
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

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

import { padToVisibleWidth } from "./terminal-layout.ts";
import type { SubagentRecord, SubagentStatus } from "./types.ts";

const RECENT_FINISHED_WIDGET_MS = 60_000;

export function isActiveStatus(status: SubagentStatus): boolean {
  return status === "starting" || status === "running" || status === "waiting for feedback";
}

export function isWorkingStatus(status: SubagentStatus): boolean {
  return status === "starting" || status === "running";
}

export function isFinishedStatus(status: SubagentStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function isVisibleInWidget(record: SubagentRecord, now: number): boolean {
  if (isActiveStatus(record.status)) {
    return true;
  }
  return record.finishedAt !== undefined && now - record.finishedAt <= RECENT_FINISHED_WIDGET_MS;
}

type SubagentWidgetFormatters = {
  elapsedFor: (record: SubagentRecord) => string;
  formatPathForDisplay: (path: string) => string;
};

function widgetTopLine(
  title: string,
  info: string,
  width: number,
  theme: ExtensionContext["ui"]["theme"],
): string {
  if (width <= 0) {
    return "";
  }
  if (width === 1) {
    return theme.fg("borderAccent", "┌");
  }

  const innerWidth = width - 2;
  const label = ` ${title}${info ? ` ${info}` : ""} `;
  const clippedLabel = truncateToWidth(label, innerWidth);
  const fill = "─".repeat(Math.max(0, innerWidth - visibleWidth(clippedLabel)));
  return `${theme.fg("borderAccent", "┌")}${theme.fg("borderAccent", clippedLabel)}${theme.fg("borderAccent", fill)}${theme.fg("borderAccent", "┐")}`;
}

function widgetBottomLine(width: number, theme: ExtensionContext["ui"]["theme"]): string {
  if (width <= 0) {
    return "";
  }
  if (width === 1) {
    return theme.fg("borderAccent", "└");
  }
  return theme.fg("borderAccent", `└${"─".repeat(width - 2)}┘`);
}

function widgetContentLine(
  left: string,
  right: string,
  width: number,
  theme: ExtensionContext["ui"]["theme"],
): string {
  if (width <= 0) {
    return "";
  }
  if (width === 1) {
    return theme.fg("borderAccent", "│");
  }

  const contentWidth = Math.max(0, width - 2);
  const rightWidth = visibleWidth(right);
  if (rightWidth >= contentWidth) {
    const clippedRight = truncateToWidth(right, contentWidth);
    return `${theme.fg("borderAccent", "│")}${padToVisibleWidth(clippedRight, contentWidth)}${theme.fg("borderAccent", "│")}`;
  }

  const clippedLeft = truncateToWidth(left, contentWidth - rightWidth);
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clippedLeft) - rightWidth));
  return `${theme.fg("borderAccent", "│")}${clippedLeft}${padding}${right}${theme.fg("borderAccent", "│")}`;
}

function widgetRow(
  age: string,
  id: string,
  role: string,
  task: string,
  stream: string,
  status: string,
  context: string,
  width: number,
): string {
  const fixedWidth = 10 + 7 + 14 + 14 + 10 + 12;
  const flexibleWidth = Math.max(56, width - fixedWidth);
  const taskWidth = Math.max(24, Math.floor(flexibleWidth * 0.35));
  const streamWidth = Math.max(32, flexibleWidth - taskWidth);
  return [
    ` ${age.padStart(7)}`,
    truncateToWidth(id, 5).padEnd(5),
    truncateToWidth(role, 12).padEnd(12),
    truncateToWidth(task, taskWidth).padEnd(taskWidth),
    truncateToWidth(stream, streamWidth).padEnd(streamWidth),
    truncateToWidth(status, 12).padEnd(12),
    truncateToWidth(context, 10).padEnd(10),
  ].join("  ");
}

function compactContextUsage(record: SubagentRecord): string {
  const usage = record.session?.getContextUsage() ?? record.contextUsage;
  if (!usage || usage.percent === null) {
    return "ctx ?";
  }
  return `ctx ${usage.percent.toFixed(1)}%`;
}

function latestRunningTool(record: SubagentRecord): string | undefined {
  const running = [...record.toolCalls.values()].filter((tool) => tool.status === "running");
  return running.at(-1)?.name;
}

function streamText(record: SubagentRecord): string {
  if (record.activity === "Turn finished." && isWorkingStatus(record.status)) {
    const runningTool = latestRunningTool(record);
    return runningTool ? `Running ${runningTool}` : "Waiting for next step";
  }
  return record.activity;
}

function statusText(record: SubagentRecord, theme: ExtensionContext["ui"]["theme"]): string {
  switch (record.status) {
    case "starting":
      return theme.fg("accent", "starting");
    case "running": {
      const tool = latestRunningTool(record);
      return tool ? theme.fg("accent", `running ${tool}`) : theme.fg("accent", "running");
    }
    case "waiting for feedback":
      return theme.fg("warning", `waiting /subagent reply ${record.id}`);
    case "completed":
      return theme.fg("success", "complete");
    case "failed":
      return theme.fg("error", "failed");
    case "stopped":
      return theme.fg("warning", "stopped");
  }
}

function renderSubagentWidgetLines(
  records: SubagentRecord[],
  width: number,
  theme: ExtensionContext["ui"]["theme"],
  formatters: SubagentWidgetFormatters,
): string[] {
  const now = Date.now();
  const visibleRecords = records.filter((record) => isVisibleInWidget(record, now));
  const activeCount = visibleRecords.filter((record) => isActiveStatus(record.status)).length;
  if (visibleRecords.length === 0) {
    return [];
  }

  const info =
    activeCount === visibleRecords.length
      ? `${activeCount} active`
      : `${activeCount} active, ${visibleRecords.length - activeCount} recent`;
  const lines = [widgetTopLine("Subagents", info, width, theme)];
  lines.push(
    widgetContentLine(
      widgetRow("AGE", "ID", "ROLE", "TASK", "STREAM", "STATUS", "CTX", width),
      "",
      width,
      theme,
    ),
  );
  const displayRecords = visibleRecords.slice(0, 3);

  for (const record of displayRecords) {
    const role = record.role?.name ?? "ad hoc";
    const row = widgetRow(
      formatters.elapsedFor(record),
      record.id,
      role,
      record.name,
      streamText(record),
      statusText(record, theme),
      theme.fg("dim", compactContextUsage(record)),
      width,
    );
    lines.push(widgetContentLine(row, "", width, theme));

    if (record.pendingFeedback) {
      const feedback = `   needs feedback: ${record.pendingFeedback.question} `;
      lines.push(
        widgetContentLine(
          theme.fg("warning", truncateToWidth(feedback, Math.max(0, width - 2))),
          "",
          width,
          theme,
        ),
      );
    }
  }

  if (visibleRecords.length > displayRecords.length) {
    lines.push(
      widgetContentLine(
        theme.fg("dim", ` ${visibleRecords.length - displayRecords.length} more sub-agent(s) `),
        "",
        width,
        theme,
      ),
    );
  }

  lines.push(widgetBottomLine(width, theme));
  return lines;
}

export class SubagentStatusWidget implements Component {
  private readonly getRecords: () => SubagentRecord[];
  private readonly theme: ExtensionContext["ui"]["theme"];
  private readonly formatters: SubagentWidgetFormatters;

  constructor(
    getRecords: () => SubagentRecord[],
    theme: ExtensionContext["ui"]["theme"],
    formatters: SubagentWidgetFormatters,
  ) {
    this.getRecords = getRecords;
    this.theme = theme;
    this.formatters = formatters;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return renderSubagentWidgetLines(this.getRecords(), width, this.theme, this.formatters);
  }
}

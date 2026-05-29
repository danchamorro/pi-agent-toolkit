import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

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

function padToWidth(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

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
    return theme.fg("accent", "+");
  }

  const innerWidth = width - 2;
  const label = ` ${title}${info ? ` ${info}` : ""} `;
  const clippedLabel = truncateToWidth(label, innerWidth);
  const fill = "-".repeat(Math.max(0, innerWidth - visibleWidth(clippedLabel)));
  return `${theme.fg("accent", "+")}${theme.fg("accent", clippedLabel)}${theme.fg("accent", fill)}${theme.fg("accent", "+")}`;
}

function widgetBottomLine(width: number, theme: ExtensionContext["ui"]["theme"]): string {
  if (width <= 0) {
    return "";
  }
  if (width === 1) {
    return theme.fg("accent", "+");
  }
  return theme.fg("accent", `+${"-".repeat(width - 2)}+`);
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
    return theme.fg("accent", "|");
  }

  const contentWidth = Math.max(0, width - 2);
  const rightWidth = visibleWidth(right);
  if (rightWidth >= contentWidth) {
    const clippedRight = truncateToWidth(right, contentWidth);
    return `${theme.fg("accent", "|")}${padToWidth(clippedRight, contentWidth)}${theme.fg("accent", "|")}`;
  }

  const clippedLeft = truncateToWidth(left, contentWidth - rightWidth);
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clippedLeft) - rightWidth));
  return `${theme.fg("accent", "|")}${clippedLeft}${padding}${right}${theme.fg("accent", "|")}`;
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
  const displayRecords = visibleRecords.slice(0, 3);

  for (const record of displayRecords) {
    const left = ` ${formatters.elapsedFor(record).padStart(5)}  ${record.id}  ${record.name}  ${formatters.formatPathForDisplay(record.cwd)} `;
    const right = `${statusText(record, theme)} ${theme.fg("dim", compactContextUsage(record))} `;
    lines.push(widgetContentLine(left, right, width, theme));

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
    } else if (record.status === "running" || record.status === "starting") {
      const activity = `   ${record.activity} `;
      lines.push(widgetContentLine(theme.fg("dim", activity), "", width, theme));
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

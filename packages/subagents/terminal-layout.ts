import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];
type TableBorderKind = "top" | "middle" | "bottom";
type CellWrap = "truncate" | "word";

type RenderBoxTableOptions = {
  theme?: Theme;
  title?: string;
  rowDividers?: boolean;
  cellWrap?: CellWrap;
};

export function renderBoxTable(
  header: string[],
  rows: string[][],
  widths: number[],
  options: RenderBoxTableOptions = {},
): string {
  const cellWrap = options.cellWrap ?? "word";
  const rowDividers = options.rowDividers ?? true;
  const top = tableBorder("top", widths, options.theme, options.title);
  const divider = tableBorder("middle", widths, options.theme);
  const bottom = tableBorder("bottom", widths, options.theme);
  const lines = [top, tableRow(header, widths, options.theme, cellWrap), divider];

  for (const row of rows) {
    lines.push(...tableRow(row, widths, options.theme, cellWrap).split("\n"));
    if (rowDividers) {
      lines.push(divider);
    }
  }

  if (rowDividers) {
    lines[lines.length - 1] = bottom;
  } else {
    lines.push(bottom);
  }

  return lines.join("\n");
}

export function renderPanel(title: string, body: string[], theme?: Theme): string {
  const bodyLines = body.flatMap((line) => line.split("\n"));
  const innerWidth = Math.max(40, visibleWidth(title) + 3, ...bodyLines.map(visibleWidth));
  const titleSegment = `─ ${title} `;
  const top = `${styleBorder("┌", theme)}${styleBorder(titleSegment, theme)}${styleBorder("─".repeat(Math.max(0, innerWidth - visibleWidth(titleSegment))), theme)}${styleBorder("┐", theme)}`;
  const bottom = `${styleBorder("└", theme)}${styleBorder("─".repeat(innerWidth), theme)}${styleBorder("┘", theme)}`;
  return [
    top,
    ...bodyLines.map(
      (line) =>
        `${styleBorder("│", theme)}${padToVisibleWidth(line, innerWidth)}${styleBorder("│", theme)}`,
    ),
    bottom,
  ].join("\n");
}

export function padToVisibleWidth(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

function tableRow(
  cells: string[],
  widths: number[],
  theme: Theme | undefined,
  cellWrap: CellWrap,
): string {
  const wrapped = cells.map((cell, index) => wrapCell(cell, widths[index] ?? 10, cellWrap));
  const rowHeight = Math.max(...wrapped.map((cell) => cell.length));
  const lines: string[] = [];
  for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
    const parts = wrapped.map((cell, cellIndex) =>
      padToVisibleWidth(cell[lineIndex] ?? "", widths[cellIndex] ?? 10),
    );
    lines.push(
      `${styleBorder("│", theme)} ${parts.join(` ${styleBorder("│", theme)} `)} ${styleBorder("│", theme)}`,
    );
  }
  return lines.join("\n");
}

function tableBorder(
  kind: TableBorderKind,
  widths: number[],
  theme: Theme | undefined,
  title?: string,
): string {
  const chars =
    kind === "top" ? ["┌", "┬", "┐"] : kind === "middle" ? ["├", "┼", "┤"] : ["└", "┴", "┘"];
  if (kind === "top" && title) {
    const plain = widths.map((width) => "─".repeat(width + 2)).join(chars[1]);
    const label = ` ${title} `;
    return styleBorder(
      `${chars[0]}${label}${"─".repeat(Math.max(0, visibleWidth(plain) - visibleWidth(label)))}${chars[2]}`,
      theme,
    );
  }
  return styleBorder(
    `${chars[0]}${widths.map((width) => "─".repeat(width + 2)).join(chars[1])}${chars[2]}`,
    theme,
  );
}

function wrapCell(cell: string, width: number, cellWrap: CellWrap): string[] {
  if (cellWrap === "truncate") {
    return cell.split("\n").map((line) => truncateToWidth(line, width));
  }
  const lines = cell.split("\n").flatMap((line) => wrapLine(line, width));
  return lines.length > 0 ? lines : [""];
}

function wrapLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) {
    return [line];
  }
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [truncateToWidth(line, width)];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = visibleWidth(word) > width ? truncateToWidth(word, width) : word;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function styleBorder(value: string, theme?: Theme): string {
  return theme ? theme.fg("borderAccent", value) : value;
}

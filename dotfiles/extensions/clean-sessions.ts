/**
 * Clean Sessions Extension
 *
 * Registers `/clean-sessions [days]` to prune old, low-value session files and
 * `/empty-session-trash` to permanently delete previously trashed sessions.
 *
 * A session is a cleanup candidate when ALL of these are true:
 *   1. Older than N days (default 30, the only configurable parameter)
 *   2. Fewer than 12 JSONL lines
 *   3. Name matches the auto-format pattern (YYYY-MM-DD ...) or has no name
 *
 * Sessions with short, manually-chosen names (no date prefix) are always exempt.
 *
 * Safety:
 *   - Only operates inside ~/.pi/agent/sessions (hardcoded, path-verified)
 *   - Only moves .jsonl files (never directories)
 *   - Moves to ~/.pi/agent/sessions/.trash/ instead of permanent delete
 *   - Always shows candidates first (dry-run by default)
 *   - Requires typing the exact count back to confirm
 *
 * The .trash folder preserves the original directory structure so files
 * can be restored by moving them back. Use /empty-session-trash to
 * permanently delete trashed sessions.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createReadStream, promises as fs, type ReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// ============================================================================
// Constants (hardcoded, not configurable)
// ============================================================================

const SESSIONS_ROOT = path.join(os.homedir(), ".pi", "agent", "sessions");
const TRASH_DIR = path.join(SESSIONS_ROOT, ".trash");
const MAX_LINES_THRESHOLD = 12;
const DEFAULT_LOOKBACK_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const AUTO_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}\s/;
const DISPLAY_TEXT_WIDTH = 48;
const DISPLAY_TEXT_TRUNCATED_WIDTH = 45;

// ============================================================================
// Types
// ============================================================================

interface SessionCandidate {
  filePath: string;
  relativePath: string;
  lineCount: number;
  ageDays: number;
  name: string | null;
  startedAt: Date;
}

interface WalkJsonlFilesOptions {
  skipResolvedDirs?: Set<string>;
}

// ============================================================================
// Helpers
// ============================================================================

function parseSessionStartFromFilename(name: string): Date | null {
  const match = name.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{3})Z_/);
  if (!match) {
    return null;
  }

  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const parsedDate = new Date(iso);

  return Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
}

function isInsideRoot(filePath: string, rootPath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);

  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
}

function isInsideSessionsRoot(filePath: string): boolean {
  return isInsideRoot(filePath, SESSIONS_ROOT);
}

function isInsideTrash(filePath: string): boolean {
  return isInsideRoot(filePath, TRASH_DIR);
}

function isAutoNamed(name: string): boolean {
  return AUTO_NAME_PATTERN.test(name);
}

function createLineReader(filePath: string): { reader: readline.Interface; stream: ReadStream } {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  return { reader, stream };
}

function pluralize(count: number, singular: string): string {
  if (count === 1) {
    return singular;
  }

  return `${singular}s`;
}

function ensureInteractiveSession(ctx: ExtensionContext, commandName: string): boolean {
  if (ctx.hasUI) {
    return true;
  }

  ctx.ui.notify(`${commandName} requires an interactive session`, "error");
  return false;
}

function formatCandidateDisplay(candidate: SessionCandidate): string {
  if (candidate.name) {
    if (candidate.name.length > DISPLAY_TEXT_WIDTH) {
      return `${candidate.name.slice(0, DISPLAY_TEXT_TRUNCATED_WIDTH)}...`;
    }

    return candidate.name;
  }

  if (candidate.relativePath.length > DISPLAY_TEXT_WIDTH) {
    return `...${candidate.relativePath.slice(-DISPLAY_TEXT_TRUNCATED_WIDTH)}`;
  }

  return candidate.relativePath;
}

function formatExactCountPrompt(count: number, action: string): string {
  return `Type "${count}" to ${action}, or anything else to cancel`;
}

function formatCleanupSummary(candidates: SessionCandidate[], lookbackDays: number): string {
  const table = formatCandidateTable(candidates);
  const sessionLabel = pluralize(candidates.length, "session");

  return `\nFound ${candidates.length} ${sessionLabel} to clean:\n\n${table}\n\nCriteria: older than ${lookbackDays}d, fewer than ${MAX_LINES_THRESHOLD} lines, auto-named or unnamed.\nManually-named sessions (no date prefix) are always preserved.`;
}

function formatCleanupResult(trashed: number, failed: number): string {
  const trashedLabel = pluralize(trashed, "session");
  const failureSuffix = failed > 0 ? ` ${failed} failed.` : "";

  return `Moved ${trashed} ${trashedLabel} to .trash.${failureSuffix} Use /empty-session-trash to permanently delete.`;
}

function formatTrashContainsMessage(fileCount: number): string {
  return `Session trash contains ${fileCount} ${pluralize(fileCount, "file")}.`;
}

function formatTrashDeletionResult(deleted: number): string {
  return `Permanently deleted ${deleted} ${pluralize(deleted, "session")} from trash.`;
}

async function confirmExactCount(
  ctx: ExtensionContext,
  count: number,
  prompt: string,
  canceledMessage: string
): Promise<boolean> {
  const input = await ctx.ui.input(prompt, "");

  if (input?.trim() === String(count)) {
    return true;
  }

  ctx.ui.notify(canceledMessage, "info");
  return false;
}

async function countLines(filePath: string): Promise<number> {
  const { reader, stream } = createLineReader(filePath);

  try {
    let count = 0;

    for await (const _line of reader) {
      count++;
    }

    return count;
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function extractSessionName(filePath: string): Promise<string | null> {
  const { reader, stream } = createLineReader(filePath);
  let name: string | null = null;

  try {
    for await (const line of reader) {
      if (!line) {
        continue;
      }

      try {
        const parsed = JSON.parse(line);

        if (parsed?.type === "session_info" && typeof parsed?.name === "string") {
          name = parsed.name.trim() || null;
        }
      } catch {
        continue;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return name;
}

async function walkJsonlFiles(root: string, options: WalkJsonlFilesOptions = {}): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  const skipResolvedDirs = options.skipResolvedDirs ?? new Set<string>();

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (skipResolvedDirs.has(path.resolve(entryPath))) {
          continue;
        }

        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(entryPath);
      }
    }
  }

  return out;
}

async function walkSessionFiles(root: string): Promise<string[]> {
  return walkJsonlFiles(root, {
    skipResolvedDirs: new Set([path.resolve(TRASH_DIR)]),
  });
}

async function walkTrashFiles(dir: string): Promise<string[]> {
  return walkJsonlFiles(dir);
}

async function findCandidates(lookbackDays: number): Promise<SessionCandidate[]> {
  const now = new Date();
  const cutoffMs = now.getTime() - lookbackDays * DAY_IN_MS;
  const allFiles = await walkSessionFiles(SESSIONS_ROOT);
  const candidates: SessionCandidate[] = [];

  for (const filePath of allFiles) {
    if (!isInsideSessionsRoot(filePath)) {
      continue;
    }

    const fileName = path.basename(filePath);
    const startedAt = parseSessionStartFromFilename(fileName);
    if (!startedAt) {
      continue;
    }

    if (startedAt.getTime() > cutoffMs) {
      continue;
    }

    const lineCount = await countLines(filePath);
    if (lineCount >= MAX_LINES_THRESHOLD) {
      continue;
    }

    const name = await extractSessionName(filePath);
    if (name && !isAutoNamed(name)) {
      continue;
    }

    const ageDays = Math.floor((now.getTime() - startedAt.getTime()) / DAY_IN_MS);
    const relativePath = path.relative(SESSIONS_ROOT, filePath);

    candidates.push({
      filePath,
      relativePath,
      lineCount,
      ageDays,
      name,
      startedAt,
    });
  }

  candidates.sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
  return candidates;
}

function formatCandidateTable(candidates: SessionCandidate[]): string {
  const lines: string[] = [];
  const header = `  ${"Age".padEnd(6)}${"Lines".padEnd(8)}${"Name / ID".padEnd(50)}`;
  const separator = `  ${"-".repeat(6)}${"-".repeat(8)}${"-".repeat(50)}`;

  lines.push(header);
  lines.push(separator);

  for (const candidate of candidates) {
    const age = `${candidate.ageDays}d`.padEnd(6);
    const lineCount = String(candidate.lineCount).padEnd(8);
    const display = formatCandidateDisplay(candidate);

    lines.push(`  ${age}${lineCount}${display}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Extension
// ============================================================================

export default function cleanSessionsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("clean-sessions", {
    description: "Prune old, low-value session files (dry-run first, then confirm)",
    handler: async (args: string, ctx: ExtensionContext) => {
      if (!ensureInteractiveSession(ctx, "clean-sessions")) {
        return;
      }

      const trimmed = args.trim();
      let lookbackDays = DEFAULT_LOOKBACK_DAYS;

      if (trimmed) {
        const parsed = parseInt(trimmed, 10);
        if (isNaN(parsed) || parsed < 1) {
          ctx.ui.notify(
            `Invalid argument: "${trimmed}". Usage: /clean-sessions [days]\nExample: /clean-sessions 60`,
            "warning"
          );
          return;
        }

        lookbackDays = parsed;
      }

      try {
        await fs.access(SESSIONS_ROOT);
      } catch {
        ctx.ui.notify(`Sessions directory not found: ${SESSIONS_ROOT}`, "error");
        return;
      }

      ctx.ui.notify(
        `Scanning sessions older than ${lookbackDays} days with fewer than ${MAX_LINES_THRESHOLD} lines...`,
        "info"
      );
      ctx.ui.setWorkingMessage(`Scanning old sessions (${lookbackDays}d lookback)...`);
      ctx.ui.setWorkingIndicator({ frames: ["[scan]"], intervalMs: 120 });

      const candidates = await findCandidates(lookbackDays);

      if (candidates.length === 0) {
        ctx.ui.setWorkingMessage();
        ctx.ui.setWorkingIndicator();
        ctx.ui.notify(
          `No cleanup candidates found (older than ${lookbackDays}d, fewer than ${MAX_LINES_THRESHOLD} lines, auto-named or unnamed).`,
          "info"
        );
        return;
      }

      ctx.ui.notify(formatCleanupSummary(candidates, lookbackDays), "info");

      const confirmed = await confirmExactCount(
        ctx,
        candidates.length,
        formatExactCountPrompt(candidates.length, "delete these sessions"),
        "Cleanup canceled. No files were deleted."
      );

      if (!confirmed) {
        ctx.ui.setWorkingMessage();
        ctx.ui.setWorkingIndicator();
        return;
      }

      let trashed = 0;
      let failed = 0;
      ctx.ui.setWorkingMessage(`Moving ${candidates.length} session(s) to trash...`);
      ctx.ui.setWorkingIndicator({ frames: ["[trash]"], intervalMs: 120 });

      for (const candidate of candidates) {
        if (!isInsideSessionsRoot(candidate.filePath)) {
          failed++;
          continue;
        }

        if (!candidate.filePath.endsWith(".jsonl")) {
          failed++;
          continue;
        }

        try {
          const trashDest = path.join(TRASH_DIR, candidate.relativePath);
          await fs.mkdir(path.dirname(trashDest), { recursive: true });
          await fs.rename(candidate.filePath, trashDest);
          trashed++;
        } catch {
          failed++;
        }
      }

      const level = failed > 0 ? "warning" : "info";

      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
      ctx.ui.notify(formatCleanupResult(trashed, failed), level);
    },
  });

  pi.registerCommand("empty-session-trash", {
    description: "Permanently delete all trashed sessions",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ensureInteractiveSession(ctx, "empty-session-trash")) {
        return;
      }

      let trashFiles: string[] = [];
      try {
        trashFiles = await walkTrashFiles(TRASH_DIR);
      } catch {
        ctx.ui.notify("Session trash is already empty.", "info");
        return;
      }

      if (trashFiles.length === 0) {
        ctx.ui.notify("Session trash is already empty.", "info");
        return;
      }

      ctx.ui.notify(formatTrashContainsMessage(trashFiles.length), "info");

      const confirmed = await confirmExactCount(
        ctx,
        trashFiles.length,
        formatExactCountPrompt(trashFiles.length, "permanently delete"),
        "Canceled. Trash was not emptied."
      );

      if (!confirmed) {
        return;
      }

      let deleted = 0;
      for (const filePath of trashFiles) {
        if (!isInsideTrash(filePath)) {
          continue;
        }

        try {
          await fs.unlink(filePath);
          deleted++;
        } catch {
          continue;
        }
      }

      try {
        await removeEmptyDirs(TRASH_DIR);
      } catch {
        // Best effort cleanup.
      }

      ctx.ui.notify(formatTrashDeletionResult(deleted), "info");
    },
  });
}

// ============================================================================
// Trash helpers
// ============================================================================

async function removeEmptyDirs(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const subdir = path.join(dir, entry.name);
    await removeEmptyDirs(subdir);

    try {
      await fs.rmdir(subdir);
    } catch {
      // Directory still contains files.
    }
  }
}

/**
 * File Search Tools Extension
 *
 * Registers `fd` and `rg` as first-class Pi tools for file-name and exact-text
 * discovery. Searches use the current session directory, bounded output, and
 * argument arrays so model-provided patterns cannot become CLI flags.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const SEARCH_TIMEOUT_MS = 60_000;

const FdParameters = Type.Object({
  pattern: Type.Optional(
    Type.String({
      description:
        "Regex matched against names, or a glob when glob is true. Omit to list everything.",
    }),
  ),
  path: Type.Optional(
    Type.String({ description: "Directory to search. Defaults to the current directory." }),
  ),
  type: Type.Optional(
    StringEnum(["file", "directory", "symlink"] as const, {
      description: "Only return entries of this type.",
    }),
  ),
  extension: Type.Optional(
    Type.String({ description: "Only return files with this extension, for example ts." }),
  ),
  glob: Type.Optional(Type.Boolean({ description: "Treat pattern as a glob instead of a regex." })),
  hidden: Type.Optional(Type.Boolean({ description: "Include hidden files and directories." })),
  max_depth: Type.Optional(
    Type.Integer({ description: "Maximum directory depth.", minimum: 1, maximum: 64 }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum results. Defaults to 1000.",
      minimum: 1,
      maximum: 10_000,
    }),
  ),
});

const RgParameters = Type.Object({
  pattern: Type.String({
    description: "Regex to search for, or literal text when fixed_strings is true.",
  }),
  path: Type.Optional(
    Type.String({ description: "File or directory to search. Defaults to the current directory." }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Only search files matching this glob, for example *.ts." }),
  ),
  file_type: Type.Optional(
    Type.String({ description: "Only search this ripgrep file type, for example ts or py." }),
  ),
  case_sensitive: Type.Optional(
    Type.Boolean({
      description: "Force case-sensitive or case-insensitive matching. Defaults to smart-case.",
    }),
  ),
  fixed_strings: Type.Optional(
    Type.Boolean({ description: "Treat pattern as literal text instead of a regex." }),
  ),
  hidden: Type.Optional(Type.Boolean({ description: "Search hidden files and directories." })),
  context: Type.Optional(
    Type.Integer({ description: "Context lines around each match.", minimum: 0, maximum: 20 }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum matches per file. Defaults to 100.",
      minimum: 1,
      maximum: 1000,
    }),
  ),
});

type FdParams = Static<typeof FdParameters>;
type RgParams = Static<typeof RgParameters>;

function normalizeSearchPath(raw: string): string {
  const path = raw.trim().replace(/^@/, "");
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function buildFdArgs(params: FdParams): string[] {
  const args = ["--color=never"];
  if (params.hidden) args.push("--hidden");
  if (params.glob) args.push("--glob");
  if (params.type) args.push("--type", { file: "f", directory: "d", symlink: "l" }[params.type]);
  if (params.extension) args.push("--extension", params.extension.replace(/^\.+/, ""));
  if (params.max_depth !== undefined) args.push("--max-depth", String(params.max_depth));
  args.push("--max-results", String(params.limit ?? 1000), "--", params.pattern ?? "");
  const path = params.path && normalizeSearchPath(params.path);
  if (path) args.push(path);
  return args;
}

export function buildRgArgs(params: RgParams): string[] {
  const args = ["--line-number", "--color=never", "--no-heading", "--with-filename"];
  if (params.case_sensitive === true) args.push("--case-sensitive");
  else if (params.case_sensitive === false) args.push("--ignore-case");
  else args.push("--smart-case");
  if (params.fixed_strings) args.push("--fixed-strings");
  if (params.hidden) args.push("--hidden");
  if (params.context !== undefined) args.push("--context", String(params.context));
  if (params.glob) args.push("--glob", params.glob);
  if (params.file_type) args.push("--type", params.file_type);
  args.push("--max-count", String(params.limit ?? 100), "--", params.pattern);
  const path = params.path && normalizeSearchPath(params.path);
  if (path) args.push(path);
  return args;
}

async function formatSearchOutput(tool: "fd" | "rg", output: string) {
  const text = output.replace(/\n+$/, "");
  const lineCount = text ? text.split("\n").length : 0;
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return { text, lineCount, truncated: false };

  const directory = await mkdtemp(join(tmpdir(), `pi-${tool}-`));
  const fullOutputPath = join(directory, "output.txt");
  await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, text, "utf8"));

  return {
    text:
      `${truncation.content}\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output: ${fullOutputPath}]`,
    lineCount,
    truncated: true,
    fullOutputPath,
  };
}

export default function fileSearchTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fd",
    label: "Find Files",
    description: `Find files and directories by name with fd. Respects .gitignore. Output is limited to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find files and directories by name with fd (fast and gitignore-aware)",
    promptGuidelines: [
      "Use fd instead of bash with find or ls -R for file-name discovery when jCodeMunch is unavailable, insufficient, or the target is non-code.",
      "Use rg instead of fd when searching file contents.",
      "Keep using bash for multi-step workflows that pipe or post-process file listings.",
    ],
    parameters: FdParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pi.exec("fd", buildFdArgs(params), {
        cwd: ctx.cwd,
        signal,
        timeout: SEARCH_TIMEOUT_MS,
      });
      if (result.killed) throw new Error("fd search timed out");
      if (result.code !== 0)
        throw new Error(
          `fd failed: ${(result.stderr || result.stdout || `exit ${result.code}`).trim()}`,
        );
      if (!result.stdout.trim()) {
        return {
          content: [{ type: "text", text: "No files found" }],
          details: { matchCount: 0, truncated: false },
        };
      }
      const output = await formatSearchOutput("fd", result.stdout);
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          matchCount: output.lineCount,
          truncated: output.truncated,
          fullOutputPath: output.fullOutputPath,
        },
      };
    },
  });

  pi.registerTool({
    name: "rg",
    label: "Search Content",
    description: `Search file contents with ripgrep. Uses smart-case, respects .gitignore, and limits output to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Search file contents with ripgrep (fast regex or literal text search)",
    promptGuidelines: [
      "Use rg instead of bash with grep for exact strings, errors, config values, logs, non-code files, or when code intelligence is insufficient.",
      "Use jCodeMunch instead of rg for source symbols, call hierarchy, blast radius, and edit preparation.",
      "Use fd instead of rg when looking for files by name rather than content.",
      "Set fixed_strings on rg when literal text contains regex metacharacters.",
    ],
    parameters: RgParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pi.exec("rg", buildRgArgs(params), {
        cwd: ctx.cwd,
        signal,
        timeout: SEARCH_TIMEOUT_MS,
      });
      if (result.killed) throw new Error("rg search timed out");
      if (result.code === 1 && !result.stdout.trim()) {
        return {
          content: [{ type: "text", text: "No matches found" }],
          details: { outputLines: 0, truncated: false },
        };
      }
      if (result.code !== 0)
        throw new Error(
          `rg failed: ${(result.stderr || result.stdout || `exit ${result.code}`).trim()}`,
        );
      const output = await formatSearchOutput("rg", result.stdout);
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          outputLines: output.lineCount,
          truncated: output.truncated,
          fullOutputPath: output.fullOutputPath,
        },
      };
    },
  });
}

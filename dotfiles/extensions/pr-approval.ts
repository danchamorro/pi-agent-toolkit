/**
 * PR Approval Extension
 *
 * Intercepts PR creation (gh pr create), PR merges (gh pr merge), and
 * force/protected-branch pushes (git push) to validate metadata and
 * require interactive approval before the operation proceeds. Blocks
 * PRs with missing titles or bodies.
 *
 * Shortcut: none.
 */

import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
  UserBashEventResult,
  ToolCallEventResult,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { TUI, KeybindingsManager } from "@earendil-works/pi-tui";
import { matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const APPROVE_OPTION = "Approve";
const DENY_OPTION = "Deny";

const REASON_INTERACTIVE_REQUIRED =
  "PR operation blocked: interactive approval is required.";
const REASON_PR_CREATE_DENIED = "gh pr create blocked: approval denied.";
const REASON_PR_MERGE_DENIED = "gh pr merge blocked: approval denied.";
const REASON_PUSH_DENIED = "git push blocked: approval denied.";
const MAX_PR_BODY_FILE_BYTES = 256 * 1024;

const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "production",
  "release",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrCreateMetadata {
  title: string | null;
  base: string | null;
  head: string | null;
  isDraft: boolean;
  reviewers: string[];
  body: string | null;
  bodyFile: string | null;
  bodySource: "inline" | "file" | null;
  bodyFileError: string | null;
}

interface PrMergeMetadata {
  prRef: string | null;
  strategy: string | null;
  deleteBranch: boolean;
  autoMerge: boolean;
}

interface PushMetadata {
  remote: string | null;
  branch: string | null;
  isForce: boolean;
  isProtected: boolean;
}

type PrOperation =
  | { kind: "pr-create"; metadata: PrCreateMetadata }
  | { kind: "pr-merge"; metadata: PrMergeMetadata }
  | { kind: "push"; metadata: PushMetadata };

// ---------------------------------------------------------------------------
// Shell parsing (mirrors commit-approval)
// ---------------------------------------------------------------------------

function shellSplit(input: string): string[] {
  const command = input.trim();
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  const flushCurrent = () => {
    if (current) {
      tokens.push(current);
      current = "";
    }
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? "";

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }

      if (ch === "\\") {
        const next = command[i + 1] ?? "";
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          i += 1;
        } else if (next === "\n") {
          i += 1;
        } else {
          current += "\\";
        }
        continue;
      }

      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === "\\") {
      const next = command[i + 1];
      if (next !== undefined) {
        current += next;
        i += 1;
      } else {
        current += "\\";
      }
      continue;
    }

    if (/\s/.test(ch)) {
      flushCurrent();
      continue;
    }

    current += ch;
  }

  flushCurrent();
  return tokens;
}

function splitByShellOperators(command: string): string[] {
  // Collapse backslash-newline continuations before splitting,
  // exactly as bash does for line continuations.
  const normalized = command.replace(/\\\n\s*/g, " ");

  // Quote-aware split: only split on &&, ||, ;, \n when outside quotes.
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i] ?? "";

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      current += ch;
      quote = ch;
      continue;
    }

    if (ch === "\n" || ch === ";") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }

    if (ch === "&" && normalized[i + 1] === "&") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    if (ch === "|" && normalized[i + 1] === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += ch;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function findExecutableIndex(tokens: string[], name: string): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;
    if (basename(token).toLowerCase() === name) return i;
    return -1;
  }
  return -1;
}

function consumeOptionValue(
  args: string[],
  index: number,
  shortFlag: string,
  longFlag: string,
): { value: string | null; skip: number } {
  const token = args[index] ?? "";

  if (token === shortFlag || token === longFlag) {
    return { value: args[index + 1] ?? null, skip: 2 };
  }

  if (token.startsWith(`${longFlag}=`)) {
    return { value: token.slice(longFlag.length + 1), skip: 1 };
  }

  if (shortFlag.length === 2 && token.startsWith(shortFlag) && token.length > shortFlag.length) {
    return { value: token.slice(shortFlag.length), skip: 1 };
  }

  return { value: null, skip: 0 };
}

function parsePrCreate(tokens: string[]): PrCreateMetadata | null {
  const ghIdx = findExecutableIndex(tokens, "gh");
  if (ghIdx < 0) return null;
  if (tokens[ghIdx + 1] !== "pr" || tokens[ghIdx + 2] !== "create") return null;

  const args = tokens.slice(ghIdx + 3);
  let title: string | null = null;
  let base: string | null = null;
  let head: string | null = null;
  let isDraft = false;
  let body: string | null = null;
  let bodyFile: string | null = null;
  let bodySource: "inline" | "file" | null = null;
  let bodyFileError: string | null = null;
  const reviewers: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? "";

    const titleOpt = consumeOptionValue(args, i, "-t", "--title");
    if (titleOpt.skip) { title = titleOpt.value; i += titleOpt.skip - 1; continue; }

    const baseOpt = consumeOptionValue(args, i, "-B", "--base");
    if (baseOpt.skip) { base = baseOpt.value; i += baseOpt.skip - 1; continue; }

    const headOpt = consumeOptionValue(args, i, "-H", "--head");
    if (headOpt.skip) { head = headOpt.value; i += headOpt.skip - 1; continue; }

    const bodyOpt = consumeOptionValue(args, i, "-b", "--body");
    if (bodyOpt.skip) {
      body = bodyOpt.value;
      bodyFile = null;
      bodySource = "inline";
      bodyFileError = null;
      i += bodyOpt.skip - 1;
      continue;
    }

    const bodyFileOpt = consumeOptionValue(args, i, "-F", "--body-file");
    if (bodyFileOpt.skip) {
      body = null;
      bodyFile = bodyFileOpt.value;
      bodySource = "file";
      bodyFileError = null;
      i += bodyFileOpt.skip - 1;
      continue;
    }

    const revOpt = consumeOptionValue(args, i, "-r", "--reviewer");
    if (revOpt.skip) { if (revOpt.value) reviewers.push(revOpt.value); i += revOpt.skip - 1; continue; }

    if (token === "-d" || token === "--draft") { isDraft = true; continue; }
  }

  return { title, base, head, isDraft, reviewers, body, bodyFile, bodySource, bodyFileError };
}

function parsePrMerge(tokens: string[]): PrMergeMetadata | null {
  const ghIdx = findExecutableIndex(tokens, "gh");
  if (ghIdx < 0) return null;
  if (tokens[ghIdx + 1] !== "pr" || tokens[ghIdx + 2] !== "merge") return null;

  const args = tokens.slice(ghIdx + 3);
  let prRef: string | null = null;
  let strategy: string | null = null;
  let deleteBranch = false;
  let autoMerge = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? "";

    if (token === "--squash" || token === "-s") { strategy = "squash"; continue; }
    if (token === "--merge") { strategy = "merge"; continue; }
    if (token === "--rebase" || token === "-r") { strategy = "rebase"; continue; }
    if (token === "--delete-branch" || token === "-d") { deleteBranch = true; continue; }
    if (token === "--auto") { autoMerge = true; continue; }

    if (!token.startsWith("-") && prRef === null) {
      prRef = token;
    }
  }

  return { prRef, strategy, deleteBranch, autoMerge };
}

function parsePush(tokens: string[]): PushMetadata | null {
  const gitIdx = findExecutableIndex(tokens, "git");
  if (gitIdx < 0) return null;

  const GIT_GLOBAL_OPTS_WITH_VALUE = new Set([
    "-c", "-C", "--exec-path", "--git-dir", "--work-tree", "--namespace",
  ]);

  let subIdx = gitIdx + 1;
  while (subIdx < tokens.length) {
    const token = tokens[subIdx] ?? "";
    if (!token.startsWith("-")) break;
    if (token === "--") return null;
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(token)) { subIdx += 2; continue; }
    if (token.startsWith("-c") && token.length > 2) { subIdx += 1; continue; }
    if (token.startsWith("-C") && token.length > 2) { subIdx += 1; continue; }
    if (token.startsWith("--") && token.includes("=")) { subIdx += 1; continue; }
    subIdx += 1;
  }

  if (tokens[subIdx] !== "push") return null;

  const args = tokens.slice(subIdx + 1);
  let isForce = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? "";

    if (token === "-f" || token === "--force" || token === "--force-with-lease") {
      isForce = true;
      continue;
    }

    if (token === "--repo") { i += 1; continue; }
    if (token === "-u" || token === "--set-upstream") continue;
    if (token.startsWith("-")) continue;

    positional.push(token);
  }

  const remote = positional[0] ?? null;
  const rawRef = positional[1] ?? null;
  const branch = rawRef && rawRef.includes(":")
    ? rawRef.split(":")[1] ?? rawRef
    : rawRef;

  const isProtected = branch !== null && PROTECTED_BRANCHES.has(branch);

  return { remote, branch, isForce, isProtected };
}

// ---------------------------------------------------------------------------
// Top-level command parser
// ---------------------------------------------------------------------------

function parsePrOperation(command: string): PrOperation | null {
  for (const segment of splitByShellOperators(command)) {
    const tokens = shellSplit(segment);

    const prCreate = parsePrCreate(tokens);
    if (prCreate) return { kind: "pr-create", metadata: prCreate };

    const prMerge = parsePrMerge(tokens);
    if (prMerge) return { kind: "pr-merge", metadata: prMerge };

    const push = parsePush(tokens);
    if (push) return { kind: "push", metadata: push };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Body-file loading
// ---------------------------------------------------------------------------

async function hydratePrCreateBodyFile(op: PrOperation, cwd: string): Promise<void> {
  if (op.kind !== "pr-create") return;

  const meta = op.metadata;
  if (meta.bodySource !== "file") return;

  if (!meta.bodyFile) {
    meta.bodyFileError = "PR body file path is missing. Provide a file path after --body-file.";
    return;
  }

  if (meta.bodyFile === "-") {
    meta.bodyFileError = "PR body file '-' reads from stdin and cannot be validated. Use a real file path.";
    return;
  }

  const filePath = resolve(cwd, meta.bodyFile);

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      meta.bodyFileError = `PR body file is not a regular file: ${meta.bodyFile}`;
      return;
    }

    if (fileInfo.size > MAX_PR_BODY_FILE_BYTES) {
      meta.bodyFileError = `PR body file is too large (${fileInfo.size} bytes; limit ${MAX_PR_BODY_FILE_BYTES} bytes): ${meta.bodyFile}`;
      return;
    }

    meta.body = await readFile(filePath, "utf8");
    meta.bodyFileError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    meta.bodyFileError = `Unable to read PR body file ${meta.bodyFile}: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

interface ValidationResult {
  issues: ValidationIssue[];
  hasErrors: boolean;
}

function validatePrCreate(meta: PrCreateMetadata): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!meta.title || meta.title.trim().length === 0) {
    issues.push({
      level: "error",
      message: "PR title is missing. Provide a descriptive title with --title.",
    });
  } else if (meta.title.trim().length < 10) {
    issues.push({
      level: "warning",
      message: `PR title is very short (${meta.title.trim().length} chars). Be descriptive.`,
    });
  }

  if (meta.bodyFileError) {
    issues.push({
      level: "error",
      message: meta.bodyFileError,
    });
  } else if (!meta.body || meta.body.trim().length === 0) {
    issues.push({
      level: "error",
      message: meta.bodySource === "file"
        ? `PR body file is empty: ${meta.bodyFile ?? "(missing file path)"}. Add content explaining what changed and why.`
        : "PR body is missing. Add --body or --body-file explaining what changed and why.",
    });
  } else if (meta.body.trim().length < 20) {
    issues.push({
      level: "warning",
      message: "PR body is very short. Include context on what changed and why.",
    });
  }

  return {
    issues,
    hasErrors: issues.some((i) => i.level === "error"),
  };
}

function validatePrMerge(meta: PrMergeMetadata): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!meta.strategy) {
    issues.push({
      level: "warning",
      message: "No merge strategy specified (--squash, --merge, or --rebase).",
    });
  }

  return {
    issues,
    hasErrors: issues.some((i) => i.level === "error"),
  };
}

function validateOperation(op: PrOperation): ValidationResult {
  switch (op.kind) {
    case "pr-create": return validatePrCreate(op.metadata);
    case "pr-merge": return validatePrMerge(op.metadata);
    case "push": return { issues: [], hasErrors: false };
  }
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues
    .map((i) => `  ${i.level === "error" ? "[x]" : "[!]"} ${i.message}`)
    .join("\n");
}

function getOperationTitle(op: PrOperation): string {
  switch (op.kind) {
    case "pr-create": return "PR Create Approval";
    case "pr-merge": return "PR Merge Approval";
    case "push": return "Push Approval";
  }
}

type PrRiskLabel = "blocked" | "critical" | "high" | "needs attention" | "normal";

function getRiskLabel(
  op: PrOperation,
  issues: ValidationIssue[] = [],
): PrRiskLabel {
  if (issues.some((issue) => issue.level === "error")) {
    return "blocked";
  }

  if (op.kind === "push" && op.metadata.isForce && op.metadata.isProtected) {
    return "critical";
  }

  if (op.kind === "push" && (op.metadata.isForce || op.metadata.isProtected)) {
    return "high";
  }

  if (op.kind === "pr-merge") {
    return "high";
  }

  if (issues.some((issue) => issue.level === "warning")) {
    return "needs attention";
  }

  return "normal";
}

function styleRisk(theme: Theme, risk: PrRiskLabel): string {
  switch (risk) {
    case "blocked":
    case "critical":
      return theme.fg("error", risk);
    case "high":
    case "needs attention":
      return theme.fg("warning", risk);
    case "normal":
      return theme.fg("success", risk);
  }
}

function statusMark(theme: Theme, ok: boolean, label: string): string {
  const mark = ok ? "[ok]" : "[!]";
  const color = ok ? "success" : "warning";
  return `${theme.fg(color, mark)} ${label}`;
}

function neutralMark(theme: Theme, label: string): string {
  return `${theme.fg("dim", "[--]")} ${label}`;
}

function appendSectionHeader(lines: string[], theme: Theme, title: string): void {
  lines.push("");
  lines.push(theme.fg("accent", theme.bold(title)));
}

function appendKeyValue(
  lines: string[],
  theme: Theme,
  key: string,
  value: string,
  width: number,
): void {
  appendWrappedLine(lines, `${theme.fg("dim", key.padEnd(10))} ${value}`, width);
}

interface BodyStats {
  sections: number;
  words: number;
}

function getBodyStats(body: string | null): BodyStats {
  if (!body?.trim()) {
    return { sections: 0, words: 0 };
  }

  const normalized = formatTextForPreview(body);
  const words = normalized
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    sections: (normalized.match(/^##\s+/gm) ?? []).length,
    words,
  };
}

function appendBodyPreview(
  lines: string[],
  theme: Theme,
  body: string,
  width: number,
): void {
  appendSectionHeader(lines, theme, "Body Preview");
  const bodyPreviewLines = formatTextForPreview(body).split("\n");

  for (const line of bodyPreviewLines.slice(0, 12)) {
    appendWrappedLine(lines, `  ${line}`, width);
  }

  if (bodyPreviewLines.length > 12) {
    const remainingLines = bodyPreviewLines.length - 12;
    appendWrappedLine(
      lines,
      theme.fg("dim", `  ... ${remainingLines} more lines`),
      width,
    );
  }
}

function appendPrCreateReview(
  lines: string[],
  theme: Theme,
  meta: PrCreateMetadata,
  width: number,
): void {
  const bodyStats = getBodyStats(meta.body);
  const branches = `${meta.head ?? "(current branch)"} -> ${meta.base ?? "(default branch)"}`;
  const reviewers = meta.reviewers.length > 0 ? meta.reviewers.join(", ") : "none";
  const bodySummary = `${bodyStats.sections} sections, ${bodyStats.words} words`;

  appendKeyValue(
    lines,
    theme,
    "Title",
    meta.title ?? "(will prompt interactively)",
    width,
  );
  appendKeyValue(lines, theme, "Branches", branches, width);
  appendKeyValue(lines, theme, "Draft", meta.isDraft ? "yes" : "no", width);
  appendKeyValue(lines, theme, "Reviewers", reviewers, width);
  appendKeyValue(lines, theme, "Body", bodySummary, width);
  if (meta.bodyFile) {
    appendKeyValue(lines, theme, "Body file", meta.bodyFile, width);
  }

  appendSectionHeader(lines, theme, "Checklist");
  lines.push("  " + statusMark(theme, Boolean(meta.title?.trim()), "Title present"));
  lines.push("  " + statusMark(theme, Boolean(meta.body?.trim()), "Body present"));
  lines.push("  " + statusMark(theme, !meta.isDraft, "Ready for review"));

  const branchChecklist = meta.base || meta.head
    ? statusMark(theme, true, "Explicit branch supplied")
    : neutralMark(theme, "Using gh default branch behavior");
  lines.push("  " + branchChecklist);

  if (meta.body) {
    appendBodyPreview(lines, theme, meta.body, width);
  }
}

function appendPrMergeReview(
  lines: string[],
  theme: Theme,
  meta: PrMergeMetadata,
  width: number,
): void {
  appendKeyValue(lines, theme, "PR", meta.prRef ?? "(current branch)", width);
  appendKeyValue(
    lines,
    theme,
    "Strategy",
    meta.strategy ?? "(will prompt interactively)",
    width,
  );
  appendKeyValue(lines, theme, "Delete", meta.deleteBranch ? "yes" : "no", width);
  appendKeyValue(lines, theme, "Auto", meta.autoMerge ? "yes" : "no", width);

  appendSectionHeader(lines, theme, "Effects");
  lines.push(
    "  " + statusMark(theme, Boolean(meta.strategy), "Merge strategy selected"),
  );
  lines.push("  " + statusMark(theme, !meta.autoMerge, "Auto-merge disabled"));
  lines.push("  " + statusMark(theme, !meta.deleteBranch, "Branch retained after merge"));
  appendWrappedLine(
    lines,
    theme.fg(
      "warning",
      "  Review carefully: merge operations change shared repository state.",
    ),
    width,
  );
}

function appendPushReview(
  lines: string[],
  theme: Theme,
  meta: PushMetadata,
  width: number,
): void {
  appendKeyValue(lines, theme, "Remote", meta.remote ?? "(default)", width);
  appendKeyValue(lines, theme, "Branch", meta.branch ?? "(current branch)", width);
  appendKeyValue(lines, theme, "Force", meta.isForce ? "yes" : "no", width);
  appendKeyValue(lines, theme, "Protected", meta.isProtected ? "yes" : "no", width);

  appendSectionHeader(lines, theme, "Checks");
  lines.push("  " + statusMark(theme, !meta.isForce, "Not a force push"));
  lines.push("  " + statusMark(theme, !meta.isProtected, "Not a protected branch"));

  if (meta.isForce || meta.isProtected) {
    appendWrappedLine(
      lines,
      theme.fg("warning", "  Verify this push is intentional before approving."),
      width,
    );
  }
}

function appendOperationReview(
  lines: string[],
  theme: Theme,
  op: PrOperation,
  width: number,
): void {
  switch (op.kind) {
    case "pr-create":
      appendPrCreateReview(lines, theme, op.metadata, width);
      return;
    case "pr-merge":
      appendPrMergeReview(lines, theme, op.metadata, width);
      return;
    case "push":
      appendPushReview(lines, theme, op.metadata, width);
      return;
  }
}

function formatTextForPreview(text: string): string {
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function appendWrappedLine(lines: string[], line: string, width: number): void {
  const match = /^(\s*)(.*)$/.exec(line);
  const indent = match?.[1] ?? "";
  const content = match?.[2] ?? line;
  const availableWidth = Math.max(1, width - indent.length);

  if (content.length === 0) {
    lines.push(indent);
    return;
  }

  const wrappedLines = wrapTextWithAnsi(content, availableWidth);
  for (const wrappedLine of wrappedLines) {
    lines.push(indent + wrappedLine);
  }
}

// ---------------------------------------------------------------------------
// Approval prompts
// ---------------------------------------------------------------------------

function buildPrCreatePrompt(meta: PrCreateMetadata): string {
  const lines = ["PR Create:"];
  lines.push(`  Title: ${meta.title ?? "(will prompt interactively)"}`);
  lines.push(`  Base:  ${meta.base ?? "(default branch)"}`);
  if (meta.head) lines.push(`  Head:  ${meta.head}`);
  lines.push(`  Draft: ${meta.isDraft ? "yes" : "no"}`);
  if (meta.reviewers.length > 0) {
    lines.push(`  Reviewers: ${meta.reviewers.join(", ")}`);
  }
  if (meta.bodyFile) {
    lines.push(`  Body file: ${meta.bodyFile}`);
  }
  if (meta.body) {
    const preview = meta.body.length > 80 ? meta.body.slice(0, 80) + "..." : meta.body;
    lines.push(`  Body:  ${preview}`);
  }
  lines.push("");
  lines.push("Approve this PR creation?");
  return lines.join("\n");
}

function buildPrMergePrompt(meta: PrMergeMetadata): string {
  const lines = ["PR Merge:"];
  lines.push(`  PR:       ${meta.prRef ?? "(current branch)"}`);
  lines.push(`  Strategy: ${meta.strategy ?? "(will prompt interactively)"}`);
  lines.push(`  Delete branch: ${meta.deleteBranch ? "yes" : "no"}`);
  if (meta.autoMerge) lines.push("  Auto-merge: yes");
  lines.push("");
  lines.push("Approve this PR merge?");
  return lines.join("\n");
}

function buildPushPrompt(meta: PushMetadata): string {
  const lines = ["Git Push:"];
  lines.push(`  Remote: ${meta.remote ?? "(default)"}`);
  lines.push(`  Branch: ${meta.branch ?? "(current branch)"}`);
  if (meta.isForce) lines.push("  ** FORCE PUSH **");
  if (meta.isProtected) lines.push(`  ** PROTECTED BRANCH: ${meta.branch} **`);
  lines.push("");
  lines.push("Approve this push?");
  return lines.join("\n");
}

function buildApprovalPrompt(
  op: PrOperation,
  issues?: ValidationIssue[],
): string {
  let prompt: string;
  switch (op.kind) {
    case "pr-create": prompt = buildPrCreatePrompt(op.metadata); break;
    case "pr-merge": prompt = buildPrMergePrompt(op.metadata); break;
    case "push": prompt = buildPushPrompt(op.metadata); break;
  }

  if (issues && issues.length > 0) {
    const issueBlock = formatValidationIssues(issues);
    prompt = prompt.replace(
      /\nApprove this /,
      `\nIssues:\n${issueBlock}\n\nApprove this `,
    );
  }

  return prompt;
}

function getDeniedReason(op: PrOperation): string {
  switch (op.kind) {
    case "pr-create": return REASON_PR_CREATE_DENIED;
    case "pr-merge": return REASON_PR_MERGE_DENIED;
    case "push": return REASON_PUSH_DENIED;
  }
}

// ---------------------------------------------------------------------------
// Gating logic
// ---------------------------------------------------------------------------

function shouldGate(op: PrOperation): boolean {
  if (op.kind === "pr-create" || op.kind === "pr-merge") return true;
  if (op.kind === "push") return op.metadata.isForce || op.metadata.isProtected;
  return false;
}

function getApprovalQuestion(op: PrOperation): string {
  switch (op.kind) {
    case "pr-create": return "Approve this PR creation?";
    case "pr-merge": return "Approve this PR merge?";
    case "push": return "Approve this push?";
  }
}

async function requestApproval(
  ctx: ExtensionContext,
  op: PrOperation,
  issues?: ValidationIssue[],
): Promise<boolean> {
  const question = getApprovalQuestion(op);
  const issueText = issues && issues.length > 0
    ? formatValidationIssues(issues)
    : undefined;
  const options = [APPROVE_OPTION, DENY_OPTION];

  const result = await ctx.ui.custom<boolean>(
    (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: boolean) => void) => {
      let selected = 0;

      function render(width: number): string[] {
        const lines: string[] = [];
        const rule = theme.fg("dim", "-".repeat(Math.min(width, 72)));
        const risk = getRiskLabel(op, issues ?? []);

        lines.push(theme.bold(getOperationTitle(op)) + theme.fg("dim", "  preflight review"));
        lines.push(rule);
        appendKeyValue(lines, theme, "Risk", styleRisk(theme, risk), width);

        appendOperationReview(lines, theme, op, width);

        if (issueText) {
          appendSectionHeader(lines, theme, "Issues");
          for (const line of issueText.split("\n")) {
            appendWrappedLine(lines, theme.fg("warning", line), width);
          }
        }

        lines.push("");
        lines.push(rule);
        appendWrappedLine(lines, theme.bold(question), width);
        lines.push("");

        for (let i = 0; i < options.length; i++) {
          const label = options[i]!;
          if (i === selected) {
            lines.push(theme.fg("accent", `> ${label}`));
          } else {
            lines.push(theme.fg("dim", `  ${label}`));
          }
        }

        lines.push("");
        appendWrappedLine(lines, theme.fg("dim", "Up/Down select  Enter confirm  Esc deny"), width);

        return lines;
      }

      function handleInput(data: string): void {
        if (matchesKey(data, "up") || matchesKey(data, "left")) {
          selected = selected > 0 ? selected - 1 : options.length - 1;
          tui.requestRender();
        } else if (matchesKey(data, "down") || matchesKey(data, "right")) {
          selected = (selected + 1) % options.length;
          tui.requestRender();
        } else if (matchesKey(data, "enter")) {
          done(selected === 0);
        } else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
          done(false);
        }
      }

      return {
        render,
        handleInput,
        invalidate() {},
      };
    },
  );

  return result === true;
}

function userBashBlocked(message: string): UserBashEventResult {
  return {
    result: {
      output: `${message}\n`,
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function prApprovalExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    if (!isToolCallEventType("bash", event)) return;

    const command = String(event.input.command ?? "").trim();
    if (!command) return;

    const op = parsePrOperation(command);
    if (!op || !shouldGate(op)) return;

    await hydratePrCreateBodyFile(op, ctx.cwd);
    const validation = validateOperation(op);

    if (validation.hasErrors) {
      return {
        block: true,
        reason: `${getDeniedReason(op).replace("approval denied", "message does not meet standards")}.\n${formatValidationIssues(validation.issues)}\nFix and retry.`,
      };
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: REASON_INTERACTIVE_REQUIRED,
      };
    }

    const approved = await requestApproval(ctx, op, validation.issues);
    if (!approved) {
      return {
        block: true,
        reason: getDeniedReason(op),
      };
    }

    return;
  });

  pi.on("user_bash", async (event, ctx) => {
    const command = event.command.trim();
    if (!command) return;

    const op = parsePrOperation(command);
    if (!op || !shouldGate(op)) return;

    await hydratePrCreateBodyFile(op, ctx.cwd);
    const validation = validateOperation(op);

    if (!ctx.hasUI) {
      if (validation.hasErrors) {
        return userBashBlocked(
          `PR operation blocked: does not meet standards.\n${formatValidationIssues(validation.issues)}`,
        );
      }
      return userBashBlocked(REASON_INTERACTIVE_REQUIRED);
    }

    const approved = await requestApproval(ctx, op, validation.issues);
    if (!approved) {
      return userBashBlocked(getDeniedReason(op));
    }

    return;
  });
}

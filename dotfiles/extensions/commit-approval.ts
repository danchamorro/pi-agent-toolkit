/**
 * Commit Approval Extension
 *
 * Intercepts git commit commands (both agent tool calls and user bash) to
 * validate the commit message against Conventional Commits standards,
 * preview staged files, warn when staged files still match gitignore rules,
 * and require interactive approval before the commit proceeds. Blocks
 * commits with missing, vague, or overly thin bodies and malformed subjects.
 *
 * Shortcut: none.
 */

import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

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

const APPROVE_OPTION = "Approve commit";
const DENY_OPTION = "Deny commit";

const REASON_INTERACTIVE_APPROVAL_REQUIRED =
  "git commit blocked: interactive approval is required.";
const REASON_APPROVAL_DENIED = "git commit blocked: approval denied.";

const PREVIEW_REUSE_PREVIOUS_MESSAGE =
  "(reusing previous commit message via --no-edit)";
const PREVIEW_EDITOR_FALLBACK =
  "(no -m/--message or -F/--file provided; approval cannot inspect editor-only messages)";

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set<string>([
  "-c",
  "-C",
  "--exec-path",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
]);

interface CommitInvocation {
  args: string[];
  cwd: string;
}

interface ParsedCommitMetadata {
  messageInputs: CommitMessageInput[];
  hasNoEdit: boolean;
}

interface CommitMessageInput {
  kind: "inline" | "file";
  value: string;
}

interface CommitMetadata {
  messages: string[];
  hasNoEdit: boolean;
  hasExplicitMessageInput: boolean;
  messageFilePaths: string[];
  messageFileErrors: string[];
}

interface CommitReviewDetails {
  stagedFiles: string[];
  ignoredStagedFiles: string[];
}

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

function isGitExecutable(token: string): boolean {
  return basename(token).toLowerCase() === "git";
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function findGitSubcommandIndex(tokens: string[]): number {
  let gitTokenIndex = 0;
  while (
    gitTokenIndex < tokens.length &&
    isEnvAssignment(tokens[gitTokenIndex] ?? "")
  ) {
    gitTokenIndex += 1;
  }

  if (
    tokens.length < gitTokenIndex + 2 ||
    !isGitExecutable(tokens[gitTokenIndex] ?? "")
  ) {
    return -1;
  }

  let i = gitTokenIndex + 1;
  while (i < tokens.length) {
    const token = tokens[i] ?? "";

    if (!token.startsWith("-")) {
      return i;
    }

    if (token === "--") {
      return -1;
    }

    if (token.startsWith("--")) {
      if (token.includes("=")) {
        i += 1;
        continue;
      }

      if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
        i += 2;
        continue;
      }

      i += 1;
      continue;
    }

    if (token.startsWith("-c") && token.length > 2) {
      i += 1;
      continue;
    }

    if (token.startsWith("-C") && token.length > 2) {
      i += 1;
      continue;
    }

    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      i += 2;
      continue;
    }

    i += 1;
  }

  return -1;
}

function resolvePathFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function getCdTarget(tokens: string[]): string | null {
  if (tokens[0] !== "cd") {
    return null;
  }

  const target = tokens[1];
  if (!target || target === "-" || target.startsWith("-")) {
    return null;
  }

  return target;
}

function getGitCwd(tokens: string[], subcommandIndex: number, baseCwd: string): string {
  let cwd = baseCwd;
  let gitTokenIndex = 0;
  while (
    gitTokenIndex < tokens.length &&
    isEnvAssignment(tokens[gitTokenIndex] ?? "")
  ) {
    gitTokenIndex += 1;
  }

  for (let i = gitTokenIndex + 1; i < subcommandIndex; i += 1) {
    const token = tokens[i] ?? "";

    if (token === "-C") {
      const next = tokens[i + 1];
      if (next) {
        cwd = resolvePathFromCwd(cwd, next);
        i += 1;
      }
      continue;
    }

    if (token.startsWith("-C") && token.length > 2 && !token.startsWith("--")) {
      cwd = resolvePathFromCwd(cwd, token.slice(2));
    }
  }

  return cwd;
}

function parseCommitInvocation(command: string, cwd: string): CommitInvocation | null {
  let currentCwd = cwd;

  for (const segment of splitByShellOperators(command)) {
    const tokens = shellSplit(segment);
    const cdTarget = getCdTarget(tokens);
    if (cdTarget) {
      currentCwd = resolvePathFromCwd(currentCwd, cdTarget);
      continue;
    }

    const subcommandIndex = findGitSubcommandIndex(tokens);

    if (subcommandIndex >= 0 && tokens[subcommandIndex] === "commit") {
      return {
        args: tokens.slice(subcommandIndex + 1),
        cwd: getGitCwd(tokens, subcommandIndex, currentCwd),
      };
    }
  }

  return null;
}

function parseCommitMetadata(args: string[]): ParsedCommitMetadata {
  const messageInputs: CommitMessageInput[] = [];
  let hasNoEdit = false;

  const addMessageInput = (
    kind: CommitMessageInput["kind"],
    value: string | undefined,
  ): boolean => {
    if (!value) {
      return false;
    }

    messageInputs.push({ kind, value });
    return true;
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? "";

    if (token === "--") {
      break;
    }

    if (token === "--no-edit") {
      hasNoEdit = true;
      continue;
    }

    if (token === "-m" || token === "--message") {
      if (addMessageInput("inline", args[i + 1])) {
        i += 1;
      }
      continue;
    }

    if (token === "-F" || token === "--file") {
      if (addMessageInput("file", args[i + 1])) {
        i += 1;
      }
      continue;
    }

    if (token.startsWith("--message=")) {
      addMessageInput("inline", token.slice("--message=".length));
      continue;
    }

    if (token.startsWith("--file=")) {
      addMessageInput("file", token.slice("--file=".length));
      continue;
    }

    if (token.startsWith("-m") && token.length > 2 && !token.startsWith("--")) {
      addMessageInput("inline", token.slice(2));
      continue;
    }

    if (token.startsWith("-F") && token.length > 2 && !token.startsWith("--")) {
      addMessageInput("file", token.slice(2));
    }
  }

  return { messageInputs, hasNoEdit };
}

function getRedirectionTarget(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";

    if (token === ">" || /^\d>$/.test(token)) {
      return tokens[i + 1] ?? null;
    }

    const compactRedirect = token.match(/^\d?>(.+)$/);
    if (compactRedirect?.[1]) {
      return compactRedirect[1];
    }
  }

  return null;
}

function getHereDocDelimiter(tokens: string[]): { delimiter: string; trimTabs: boolean } | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";

    if (token === "<<" || token === "<<-") {
      const delimiter = tokens[i + 1];
      return delimiter ? { delimiter, trimTabs: token === "<<-" } : null;
    }

    if (token.startsWith("<<-") && token.length > 3) {
      return { delimiter: token.slice(3), trimTabs: true };
    }

    if (token.startsWith("<<") && token.length > 2) {
      return { delimiter: token.slice(2), trimTabs: false };
    }
  }

  return null;
}

function getHereDocMessageForFile(
  command: string,
  filePath: string,
  cwd: string,
): string | null {
  if (filePath === "-") {
    return null;
  }

  const expectedPath = resolvePathFromCwd(cwd, filePath);
  const lines = command.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const tokens = shellSplit(lines[i] ?? "");
    const target = getRedirectionTarget(tokens);
    const hereDoc = getHereDocDelimiter(tokens);

    if (!target || !hereDoc) {
      continue;
    }

    if (resolvePathFromCwd(cwd, target) !== expectedPath) {
      continue;
    }

    const content: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      const delimiterCandidate = hereDoc.trimTabs ? line.replace(/^\t+/, "") : line;
      if (delimiterCandidate === hereDoc.delimiter) {
        return content.join("\n");
      }

      content.push(line);
    }

    return null;
  }

  return null;
}

async function loadCommitMessageFile(
  command: string,
  filePath: string,
  cwd: string,
): Promise<string> {
  if (filePath === "-") {
    throw new Error("message file uses stdin, which approval cannot preview");
  }

  const hereDocMessage = getHereDocMessageForFile(command, filePath, cwd);
  if (hereDocMessage !== null) {
    return hereDocMessage;
  }

  return readFile(resolvePathFromCwd(cwd, filePath), "utf8");
}

async function resolveCommitMetadata(
  command: string,
  invocation: CommitInvocation,
): Promise<CommitMetadata> {
  const parsed = parseCommitMetadata(invocation.args);
  const messages: string[] = [];
  const messageFilePaths: string[] = [];
  const messageFileErrors: string[] = [];

  for (const input of parsed.messageInputs) {
    if (input.kind === "inline") {
      messages.push(input.value);
      continue;
    }

    messageFilePaths.push(input.value);
    try {
      messages.push(await loadCommitMessageFile(command, input.value, invocation.cwd));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      messageFileErrors.push(`${input.value}: ${message}`);
    }
  }

  return {
    messages,
    hasNoEdit: parsed.hasNoEdit,
    hasExplicitMessageInput: parsed.messageInputs.length > 0,
    messageFilePaths,
    messageFileErrors,
  };
}

async function parseCommitMetadataFromCommand(
  command: string,
  cwd: string,
): Promise<CommitMetadata | null> {
  const invocation = parseCommitInvocation(command, cwd);
  if (!invocation) {
    return null;
  }

  return resolveCommitMetadata(command, invocation);
}

function normalizeCommitMessageText(message: string): string {
  return message
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function getNormalizedMessages(metadata: CommitMetadata): string[] {
  return metadata.messages.map(normalizeCommitMessageText);
}

function getCommitMessagePreview(metadata: CommitMetadata): string {
  if (metadata.messages.length > 0) {
    return getNormalizedMessages(metadata).join("\n\n");
  }

  if (metadata.messageFileErrors.length > 0) {
    return `Commit message file could not be read:\n${metadata.messageFileErrors.join("\n")}`;
  }

  if (metadata.hasNoEdit) {
    return PREVIEW_REUSE_PREVIOUS_MESSAGE;
  }

  return PREVIEW_EDITOR_FALLBACK;
}

function splitNullSeparated(input: string): string[] {
  return input.split("\0").filter(Boolean);
}

async function getGitRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.code !== 0) {
    return null;
  }

  const gitRoot = result.stdout?.trim();
  return gitRoot ? gitRoot : null;
}

async function getCommitReviewDetails(
  pi: ExtensionAPI,
  cwd: string,
): Promise<CommitReviewDetails> {
  const gitRoot = await getGitRoot(pi, cwd);
  if (!gitRoot) {
    return { stagedFiles: [], ignoredStagedFiles: [] };
  }

  const stagedResult = await pi.exec(
    "git",
    ["diff", "--cached", "--name-only", "-z"],
    { cwd: gitRoot },
  );

  const stagedFiles = stagedResult.code === 0 && stagedResult.stdout
    ? splitNullSeparated(stagedResult.stdout)
    : [];

  if (stagedFiles.length === 0) {
    return { stagedFiles, ignoredStagedFiles: [] };
  }

  const ignoredResult = await pi.exec(
    "git",
    ["ls-files", "-ci", "--exclude-standard", "-z", "--", ...stagedFiles],
    { cwd: gitRoot },
  );

  const ignoredStagedFiles = ignoredResult.code === 0 && ignoredResult.stdout
    ? [...new Set(splitNullSeparated(ignoredResult.stdout))]
    : [];

  return { stagedFiles, ignoredStagedFiles };
}

function getCommitReviewIssues(review: CommitReviewDetails): ValidationIssue[] {
  if (review.ignoredStagedFiles.length === 0) {
    return [];
  }

  const noun = review.ignoredStagedFiles.length === 1
    ? "file still matches"
    : "files still match";

  return [{
    level: "warning",
    message: `${review.ignoredStagedFiles.length} staged ${noun} gitignore rules. Review carefully because ignored files often reach the index through git add -f or git add --force.`,
  }];
}

function appendWrappedText(
  lines: string[],
  text: string,
  width: number,
  indent = "",
): void {
  const availableWidth = Math.max(1, width - indent.length);

  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      lines.push(indent);
      continue;
    }

    const wrappedLines = wrapTextWithAnsi(rawLine, availableWidth);
    for (const wrappedLine of wrappedLines) {
      lines.push(indent + wrappedLine);
    }
  }
}

function appendFilePreview(lines: string[], files: string[], width: number, maxFiles = 12): void {
  if (files.length === 0) {
    appendWrappedText(lines, "(none detected)", width, "  ");
    return;
  }

  for (const file of files.slice(0, maxFiles)) {
    appendWrappedText(lines, file, width, "  ");
  }

  if (files.length > maxFiles) {
    appendWrappedText(lines, `... ${files.length - maxFiles} more`, width, "  ");
  }
}

// ---------------------------------------------------------------------------
// Commit message validation
// ---------------------------------------------------------------------------

interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

interface ValidationResult {
  issues: ValidationIssue[];
  hasErrors: boolean;
}

const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|refactor|docs|test|chore|style|perf|ci|build)(\(.+?\))?: .+/;
const COMMIT_BODY_MIN_CHARS = 32;
const COMMIT_BODY_MIN_WORDS = 6;
const COMMIT_BODY_QUALITY_HINT =
  "Explain why the change was needed, what constraint or problem it addresses, and any important behavior or impact.";
const COMMIT_BODY_MOTIVATION_RE =
  /\b(because|so that|to avoid|to prevent|to support|to keep|to reduce|to improve|to make|while keeping|without changing)\b/i;
const VAGUE_COMMIT_BODY_PATTERNS = [
  /^(update|change|fix|adjust|cleanup|clean up|refactor|tweak)(?: [a-z]+){0,2}[.!]?$/i,
  /^(minor|small|misc(?:ellaneous)?) (?:change|changes|cleanup|fix|fixes|update|updates)[.!]?$/i,
  /^address review comments[.!]?$/i,
  /^no further details[.!]?$/i,
];

function getCommitSubject(metadata: CommitMetadata): string {
  const firstMessage = getNormalizedMessages(metadata)[0] ?? "";
  return (firstMessage.split("\n")[0] ?? "").trimEnd();
}

function getCommitBody(metadata: CommitMetadata): string {
  const normalizedMessages = getNormalizedMessages(metadata);

  if (normalizedMessages.length >= 2) {
    return normalizedMessages.slice(1).join("\n\n").trim();
  }

  if (normalizedMessages.length === 1) {
    const firstMessage = normalizedMessages[0] ?? "";
    const firstNewlineIndex = firstMessage.indexOf("\n");
    if (firstNewlineIndex === -1) {
      return "";
    }

    return firstMessage.slice(firstNewlineIndex + 1).trim();
  }

  return "";
}

function getCompactCommitBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

function countCommitBodySentences(body: string): number {
  return body
    .split(/[.!?](?:\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function validateCommitMessage(metadata: CommitMetadata): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!metadata.hasExplicitMessageInput && !metadata.hasNoEdit) {
    issues.push({
      level: "error",
      message:
        "Commit message must be provided with -m/--message or -F/--file so approval can preview it.",
    });
  }

  if (metadata.hasNoEdit && metadata.messages.length === 0) {
    issues.push({
      level: "error",
      message:
        "Commit message reuse via --no-edit cannot be previewed by approval. Provide the message explicitly.",
    });
  }

  for (const messageFileError of metadata.messageFileErrors) {
    issues.push({
      level: "error",
      message: `Commit message file could not be read: ${messageFileError}`,
    });
  }

  if (metadata.messages.length === 0) {
    return {
      issues,
      hasErrors: issues.some((i) => i.level === "error"),
    };
  }

  const subject = getCommitSubject(metadata);

  if (!CONVENTIONAL_COMMIT_RE.test(subject)) {
    issues.push({
      level: "error",
      message:
        "Subject must use Conventional Commits: type(scope): subject",
    });
  }

  if (subject.length > 72) {
    issues.push({
      level: "warning",
      message: `Subject is ${subject.length} chars (keep under 72, ideally under 50)`,
    });
  }

  const body = getCommitBody(metadata);
  const compactBody = getCompactCommitBody(body);

  if (compactBody.length === 0) {
    issues.push({
      level: "error",
      message:
        "Missing commit body. Add a second -m explaining why this change was made.",
    });
  } else {
    const bodyWordCount = compactBody.split(/\s+/).filter(Boolean).length;
    const bodySentenceCount = countCommitBodySentences(compactBody);

    if (
      compactBody.length < COMMIT_BODY_MIN_CHARS ||
      bodyWordCount < COMMIT_BODY_MIN_WORDS
    ) {
      issues.push({
        level: "error",
        message:
          `Commit body is too thin (${bodyWordCount} words, ${compactBody.length} chars). Add 2 to 4 sentences explaining why this change was needed.`,
      });
    } else if (VAGUE_COMMIT_BODY_PATTERNS.some((pattern) => pattern.test(compactBody))) {
      issues.push({
        level: "error",
        message: `Commit body is too vague. ${COMMIT_BODY_QUALITY_HINT}`,
      });
    }

    if (
      bodySentenceCount < 2 &&
      !COMMIT_BODY_MOTIVATION_RE.test(compactBody)
    ) {
      issues.push({
        level: "warning",
        message:
          `Commit body does not clearly explain motivation or impact. ${COMMIT_BODY_QUALITY_HINT}`,
      });
    }
  }

  return {
    issues,
    hasErrors: issues.some((i) => i.level === "error"),
  };
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues
    .map((i) => `  ${i.level === "error" ? "[x]" : "[!]"} ${i.message}`)
    .join("\n");
}

type CommitRiskLabel = "blocked" | "needs attention" | "normal";

interface CommitBodyStats {
  paragraphs: number;
  words: number;
}

function getRiskLabel(
  review: CommitReviewDetails,
  issues: ValidationIssue[] = [],
): CommitRiskLabel {
  if (issues.some((issue) => issue.level === "error")) {
    return "blocked";
  }

  const hasWarnings = issues.some((issue) => issue.level === "warning");
  if (hasWarnings || review.ignoredStagedFiles.length > 0) {
    return "needs attention";
  }

  return "normal";
}

function styleRisk(theme: Theme, risk: CommitRiskLabel): string {
  switch (risk) {
    case "blocked":
      return theme.fg("error", risk);
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

function getCommitBodyStats(body: string): CommitBodyStats {
  const compact = getCompactCommitBody(body);
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean).length;

  return {
    paragraphs,
    words: compact ? compact.split(/\s+/).filter(Boolean).length : 0,
  };
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
  appendWrappedText(lines, `${theme.fg("dim", key.padEnd(10))} ${value}`, width);
}

// ---------------------------------------------------------------------------
// Approval prompt
// ---------------------------------------------------------------------------

async function requestApproval(
  ctx: ExtensionContext,
  metadata: CommitMetadata,
  review: CommitReviewDetails,
  issues?: ValidationIssue[],
): Promise<boolean> {
  const messagePreview = getCommitMessagePreview(metadata);
  const issueLines = issues && issues.length > 0
    ? formatValidationIssues(issues)
    : undefined;

  const options = [APPROVE_OPTION, DENY_OPTION];

  const result = await ctx.ui.custom<boolean>(
    (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: boolean) => void) => {
      let selected = 0;

      function render(width: number): string[] {
        const lines: string[] = [];
        const rule = theme.fg("dim", "-".repeat(Math.min(width, 72)));
        const allIssues = issues ?? [];
        const risk = getRiskLabel(review, allIssues);
        const subject = getCommitSubject(metadata) || "(no subject provided)";
        const body = getCommitBody(metadata);
        const bodyStats = getCommitBodyStats(body);
        const messageWillOpenEditor = metadata.messages.length === 0 && !metadata.hasNoEdit;
        const messageReusesPrevious = metadata.messages.length === 0 && metadata.hasNoEdit;
        const messageIsDeferred = messageWillOpenEditor || messageReusesPrevious;
        const hasConventionalSubject =
          messageIsDeferred || CONVENTIONAL_COMMIT_RE.test(subject);
        const hasBody = messageIsDeferred || bodyStats.words > 0;

        let bodySummary = `${bodyStats.paragraphs} paragraphs, ${bodyStats.words} words`;
        if (messageReusesPrevious) {
          bodySummary = "reusing previous commit message";
        }

        let subjectChecklist = statusMark(
          theme,
          hasConventionalSubject,
          "Conventional Commit subject",
        );
        let bodyChecklist = statusMark(theme, hasBody, "Commit body present");
        if (messageWillOpenEditor) {
          subjectChecklist = neutralMark(theme, "Subject will be provided by editor");
          bodyChecklist = neutralMark(theme, "Body will be provided by editor");
        } else if (messageReusesPrevious) {
          subjectChecklist = neutralMark(theme, "Subject will be reused from previous commit");
          bodyChecklist = neutralMark(theme, "Body will be reused from previous commit");
        }

        lines.push(theme.bold("Commit Approval") + theme.fg("dim", "  preflight review"));
        lines.push(rule);
        appendKeyValue(lines, theme, "Risk", styleRisk(theme, risk), width);
        appendKeyValue(lines, theme, "Subject", subject, width);
        appendKeyValue(lines, theme, "Body", bodySummary, width);
        appendKeyValue(lines, theme, "Staged", `${review.stagedFiles.length} files`, width);
        appendKeyValue(
          lines,
          theme,
          "Ignored",
          `${review.ignoredStagedFiles.length} staged ignored files`,
          width,
        );

        appendSectionHeader(lines, theme, "Checklist");
        lines.push("  " + subjectChecklist);
        lines.push("  " + bodyChecklist);
        lines.push("  " + statusMark(theme, review.stagedFiles.length > 0, "Staged files detected"));
        lines.push("  " + statusMark(theme, review.ignoredStagedFiles.length === 0, "No staged ignored files"));

        appendSectionHeader(lines, theme, "Message Preview");
        appendWrappedText(lines, messagePreview, width, "  ");

        appendSectionHeader(lines, theme, `Staged Files (${review.stagedFiles.length})`);
        appendFilePreview(lines, review.stagedFiles, width);

        if (review.ignoredStagedFiles.length > 0) {
          appendSectionHeader(
            lines,
            theme,
            `Still Matched By Gitignore (${review.ignoredStagedFiles.length})`,
          );
          appendFilePreview(lines, review.ignoredStagedFiles, width, 8);
        }

        if (issueLines) {
          appendSectionHeader(lines, theme, "Issues");
          for (const line of issueLines.split("\n")) {
            appendWrappedText(lines, theme.fg("warning", line), width);
          }
        }

        lines.push("");
        lines.push(rule);
        lines.push(theme.bold("Approve this commit?"));
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
        appendWrappedText(lines, theme.fg("dim", "Up/Down select  Enter confirm  Esc deny"), width);

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

export default function commitApprovalExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const command = String(event.input.command ?? "").trim();
    if (!command) {
      return;
    }

    const metadata = await parseCommitMetadataFromCommand(command, ctx.cwd);
    if (!metadata) {
      return;
    }

    const validation = validateCommitMessage(metadata);

    if (validation.hasErrors) {
      return {
        block: true,
        reason: `git commit blocked: message does not meet standards.\n${formatValidationIssues(validation.issues)}\nFix the commit message and retry.`,
      };
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: REASON_INTERACTIVE_APPROVAL_REQUIRED,
      };
    }

    const review = await getCommitReviewDetails(pi, ctx.cwd);
    const approvalIssues = [...validation.issues, ...getCommitReviewIssues(review)];

    const approved = await requestApproval(ctx, metadata, review, approvalIssues);
    if (!approved) {
      return {
        block: true,
        reason: REASON_APPROVAL_DENIED,
      };
    }

    return;
  });

  pi.on("user_bash", async (event, ctx) => {
    const command = event.command.trim();
    if (!command) {
      return;
    }

    const metadata = await parseCommitMetadataFromCommand(command, ctx.cwd);
    if (!metadata) {
      return;
    }

    const validation = validateCommitMessage(metadata);

    if (validation.hasErrors) {
      return userBashBlocked(
        `git commit blocked: message does not meet standards.\n${formatValidationIssues(validation.issues)}\nFix the commit message and retry.`,
      );
    }

    if (!ctx.hasUI) {
      return userBashBlocked(REASON_INTERACTIVE_APPROVAL_REQUIRED);
    }

    const review = await getCommitReviewDetails(pi, ctx.cwd);
    const approvalIssues = [...validation.issues, ...getCommitReviewIssues(review)];

    const approved = await requestApproval(ctx, metadata, review, approvalIssues);
    if (!approved) {
      return userBashBlocked(REASON_APPROVAL_DENIED);
    }

    return;
  });
}

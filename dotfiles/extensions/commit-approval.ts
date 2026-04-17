/**
 * Commit Approval Extension
 *
 * Intercepts git commit commands (both agent tool calls and user bash) to
 * validate the commit message against Conventional Commits standards,
 * preview staged files, warn when staged files still match gitignore rules,
 * and require interactive approval before the commit proceeds. Blocks
 * commits with missing, vague, or overly thin bodies and malformed subjects.
 */

import { basename } from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
  UserBashEventResult,
  ToolCallEventResult,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { TUI, KeybindingsManager } from "@mariozechner/pi-tui";
import { matchesKey, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const APPROVE_OPTION = "Approve commit";
const DENY_OPTION = "Deny commit";

const REASON_INTERACTIVE_APPROVAL_REQUIRED =
  "git commit blocked: interactive approval is required.";
const REASON_APPROVAL_DENIED = "git commit blocked: approval denied.";

const PREVIEW_REUSE_PREVIOUS_MESSAGE =
  "(reusing previous commit message via --no-edit)";
const PREVIEW_EDITOR_FALLBACK =
  "(no -m/--message provided; git may open your editor)";

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
}

interface CommitMetadata {
  messages: string[];
  hasNoEdit: boolean;
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

function parseCommitInvocation(command: string): CommitInvocation | null {
  for (const segment of splitByShellOperators(command)) {
    const tokens = shellSplit(segment);
    const subcommandIndex = findGitSubcommandIndex(tokens);

    if (subcommandIndex >= 0 && tokens[subcommandIndex] === "commit") {
      return { args: tokens.slice(subcommandIndex + 1) };
    }
  }

  return null;
}

function parseCommitMetadata(args: string[]): CommitMetadata {
  const messages: string[] = [];
  let hasNoEdit = false;

  const addMessage = (value: string | undefined): boolean => {
    if (!value) {
      return false;
    }

    messages.push(value);
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
      if (addMessage(args[i + 1])) {
        i += 1;
      }
      continue;
    }

    if (token.startsWith("--message=")) {
      addMessage(token.slice("--message=".length));
      continue;
    }

    if (token.startsWith("-m") && token.length > 2 && !token.startsWith("--")) {
      addMessage(token.slice(2));
    }
  }

  return { messages, hasNoEdit };
}

function parseCommitMetadataFromCommand(
  command: string,
): CommitMetadata | null {
  const invocation = parseCommitInvocation(command);
  if (!invocation) {
    return null;
  }

  return parseCommitMetadata(invocation.args);
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

  if (metadata.messages.length === 0) {
    return { issues, hasErrors: false };
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
        const rule = theme.fg("dim", "-".repeat(Math.min(width, 60)));

        lines.push(theme.bold("Commit message preview:"));
        lines.push("");
        appendWrappedText(lines, messagePreview, width, "  ");

        lines.push("");
        lines.push(rule);
        lines.push(theme.bold(`Staged files (${review.stagedFiles.length}):`));
        appendFilePreview(lines, review.stagedFiles, width);

        if (review.ignoredStagedFiles.length > 0) {
          lines.push("");
          appendWrappedText(
            lines,
            theme.fg(
              "warning",
              `Still matched by gitignore rules (${review.ignoredStagedFiles.length}):`,
            ),
            width,
          );
          appendFilePreview(lines, review.ignoredStagedFiles, width, 8);
        }

        if (issueLines) {
          lines.push("");
          lines.push(rule);
          appendWrappedText(lines, theme.fg("warning", "Issues:"), width);
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

    const metadata = parseCommitMetadataFromCommand(command);
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

    const metadata = parseCommitMetadataFromCommand(command);
    if (!metadata) {
      return;
    }

    const validation = validateCommitMessage(metadata);

    if (!ctx.hasUI) {
      if (validation.hasErrors) {
        return userBashBlocked(
          `git commit blocked: message does not meet standards.\n${formatValidationIssues(validation.issues)}`,
        );
      }
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

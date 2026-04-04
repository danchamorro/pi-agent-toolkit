/**
 * Find Session Extension
 *
 * Commands:
 *   /find-session [query]
 *
 * Opens a dedicated TUI for searching Pi session history across
 * ~/.pi/agent/sessions/. The extension scans session metadata plus the first
 * and last user messages, ranks the best matches with the active model via
 * `completeSimple`, lets you refine the search iteratively, and resumes into
 * the selected session.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
  Input,
  KeybindingsManager,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
  type TUI,
} from "@mariozechner/pi-tui";
import { createReadStream, type Dirent, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const SESSION_ROOT = path.join(os.homedir(), ".pi", "agent", "sessions");
const MAX_LLM_CANDIDATES = 15;
const MAX_RESULTS = 8;
const MIN_RESULT_CONFIDENCE = 70;
const MAX_PREVIEW_LENGTH = 180;
const MAX_STORED_USER_MESSAGE_SAMPLES = 12;
const MAX_PROMPT_SNIPPETS = 3;
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const STOP_WORDS = new Set([
  "a",
  "about",
  "also",
  "an",
  "and",
  "at",
  "be",
  "because",
  "build",
  "building",
  "but",
  "by",
  "create",
  "creating",
  "find",
  "for",
  "from",
  "give",
  "gives",
  "how",
  "i",
  "in",
  "into",
  "it",
  "its",
  "like",
  "looking",
  "me",
  "my",
  "need",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "please",
  "session",
  "sessions",
  "that",
  "the",
  "their",
  "them",
  "there",
  "thing",
  "this",
  "to",
  "trying",
  "use",
  "want",
  "was",
  "we",
  "where",
  "with",
  "work",
  "worked",
  "working",
]);
const SEARCH_TYPO_NORMALIZATIONS = [
  [/\bextion\b/g, "extension"],
  [/\bextions\b/g, "extensions"],
  [/\bextention\b/g, "extension"],
  [/\bextentions\b/g, "extensions"],
  [/\btryoing\b/g, "trying"],
] as const;
const SESSION_NAME_PREFIX = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:AM|PM)\s+/i;
const LEADING_NOISE_PATTERNS = [
  /^<(?:skill|file)\b[\s\S]*?<\/(?:skill|file)>\s*/i,
  /^\[QUESTION MODE ACTIVE\][\s\S]*?confirmation first\.\s*/i,
  /^References are relative to\s+\S+\.?\s*/i,
  /^<!--[\s\S]*?-->\s*/i,
] as const;
const NOISY_TEXT_MARKERS = [
  "<skill name=",
  "<file name=",
  "references are relative to",
  "available tools:",
  "project context",
  "current date:",
  "current working directory:",
  "<available_skills>",
  "## global agent rules",
  "## rule priority",
  "## writing style",
];

interface SessionCandidate {
  filePath: string;
  relativePath: string;
  sessionId: string | null;
  name: string | null;
  cwd: string | null;
  startedAt: Date;
  firstUserMessage: string | null;
  lastUserMessage: string | null;
  userMessageSamples: string[];
  userMessageCount: number;
  searchText: string;
}

interface RankedSessionCandidate extends SessionCandidate {
  why: string;
  heuristicScore: number;
  confidence: number | null;
}

interface SearchTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

interface RankingResponse {
  results?: Array<{
    id?: string;
    why?: string;
    confidence?: number;
  }>;
}

interface SearchProgress {
  phase: "scan" | "parse" | "rank";
  message: string;
}

interface SearchTerms {
  normalizedQuery: string;
  keywords: string[];
}

interface FindSessionSelection {
  sessionPath: string;
}

interface FindSessionComponentOptions {
  tui: TUI;
  theme: SearchTheme;
  keybindings: KeybindingsManager;
  model: NonNullable<ExtensionCommandContext["model"]>;
  modelRegistry: ExtensionCommandContext["modelRegistry"];
  initialQuery: string;
  onDone: (value: FindSessionSelection | null) => void;
}

function parseSessionStartFromFilename(name: string): Date | null {
  const match = name.match(
    /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{3})Z_/,
  );
  if (!match) {
    return null;
  }

  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const parsedDate = new Date(iso);
  return Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
}

function createLineReader(filePath: string): {
  reader: readline.Interface;
  stream: ReturnType<typeof createReadStream>;
} {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  return { reader, stream };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSearchString(text: string): string {
  let normalized = normalizeWhitespace(text).toLowerCase();
  for (const [pattern, replacement] of SEARCH_TYPO_NORMALIZATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function stripLeadingNoiseBlocks(text: string): string {
  let cleaned = text.trim();
  while (true) {
    const previous = cleaned;
    cleaned = cleaned.replace(SESSION_NAME_PREFIX, "").trim();
    for (const pattern of LEADING_NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, "").trim();
    }
    if (cleaned === previous) {
      return cleaned;
    }
  }
}

function isLikelyInjectedText(text: string): boolean {
  const normalized = normalizeSearchString(text);
  if (!normalized) return false;
  if (NOISY_TEXT_MARKERS.some((marker) => normalized.includes(marker)))
    return true;
  const markdownHeadingCount = (text.match(/\n#{1,3}\s/g) ?? []).length;
  return (
    normalized.length > 220 &&
    (markdownHeadingCount >= 2 ||
      normalized.includes("```") ||
      normalized.includes("available tools:"))
  );
}

function sanitizeSessionName(name: string): string | null {
  const cleaned = normalizeWhitespace(stripLeadingNoiseBlocks(name));
  if (!cleaned) return null;
  if (isLikelyInjectedText(cleaned)) return null;
  return cleaned;
}

function sanitizeUserMessage(text: string): string | null {
  const cleaned = normalizeWhitespace(stripLeadingNoiseBlocks(text));
  if (!cleaned) return null;
  if (isLikelyInjectedText(cleaned) && cleaned.length > 160) return null;
  return cleaned;
}

function previewText(text: string, maxLength = MAX_PREVIEW_LENGTH): string {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function extractTextContent(
  content: unknown,
  sanitizer: (text: string) => string | null = sanitizeUserMessage,
): string | null {
  if (typeof content === "string") {
    return sanitizer(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .filter((part): part is { type: "text"; text: string } => {
      return (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      );
    })
    .map((part) => part.text)
    .join(" ");

  return sanitizer(text);
}

function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractKeywords(text: string): string[] {
  const matches =
    normalizeSearchString(text).match(/[a-z0-9][a-z0-9./_-]*/g) ?? [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const match of matches) {
    if (match.length < 2) continue;
    if (/^\d+$/.test(match)) continue;
    if (STOP_WORDS.has(match)) continue;
    if (seen.has(match)) continue;
    seen.add(match);
    keywords.push(match);
  }

  return keywords;
}

function countKeywordMatches(searchText: string, keywords: string[]): number {
  let matches = 0;
  for (const keyword of keywords) {
    if (searchText.includes(keyword)) {
      matches += 1;
    }
  }
  return matches;
}

function createSearchTerms(query: string): SearchTerms {
  return {
    normalizedQuery: normalizeSearchString(query),
    keywords: extractKeywords(query),
  };
}

function dedupeSnippets(snippets: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const snippet of snippets) {
    if (!snippet) continue;
    const key = normalizeSearchString(snippet);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(snippet);
  }

  return deduped;
}

function getCandidateMessageSnippets(candidate: SessionCandidate): string[] {
  return dedupeSnippets([
    candidate.firstUserMessage,
    ...candidate.userMessageSamples,
    candidate.lastUserMessage,
  ]);
}

function scoreSnippetMatch(snippet: string, searchTerms: SearchTerms): number {
  const normalizedSnippet = normalizeSearchString(snippet);
  let score = 0;

  if (searchTerms.normalizedQuery) {
    if (normalizedSnippet.includes(searchTerms.normalizedQuery)) score += 14;
    if (
      searchTerms.keywords.length > 0 &&
      searchTerms.keywords.every((keyword) =>
        normalizedSnippet.includes(keyword),
      )
    ) {
      score += 8;
    }
  }

  score += countKeywordMatches(normalizedSnippet, searchTerms.keywords) * 4;
  return score;
}

function selectRelevantSnippets(
  candidate: SessionCandidate,
  query: string,
  limit = MAX_PROMPT_SNIPPETS,
): string[] {
  const snippets = getCandidateMessageSnippets(candidate);
  if (snippets.length === 0) return [];

  const searchTerms = createSearchTerms(query);
  if (!searchTerms.normalizedQuery && searchTerms.keywords.length === 0) {
    return snippets.slice(0, limit);
  }

  const scored = snippets
    .map((snippet, index) => ({
      snippet,
      index,
      score: scoreSnippetMatch(snippet, searchTerms),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    });

  const positive = scored.filter((item) => item.score > 0);
  const pool = positive.length > 0 ? positive : scored;
  return pool.slice(0, limit).map((item) => item.snippet);
}

function isNegativeMatchExplanation(reason: string): boolean {
  const normalized = normalizeSearchString(reason);
  return [
    " but ",
    " not ",
    " however ",
    " unrelated",
    " different topic",
    " near miss",
    " instead of ",
    " rather than ",
  ].some((marker) => normalized.includes(marker));
}

function toHomeRelative(p: string | null): string {
  if (!p) return "unknown";
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function getProjectLabel(candidate: SessionCandidate): string {
  if (!candidate.cwd) return "unknown project";
  return path.basename(candidate.cwd) || toHomeRelative(candidate.cwd);
}

function getDisplayName(candidate: SessionCandidate): string {
  if (candidate.name && candidate.name.length <= 72) return candidate.name;
  if (candidate.firstUserMessage)
    return previewText(candidate.firstUserMessage, 52);
  if (candidate.name) return previewText(candidate.name, 52);
  return `Session ${DATE_FORMATTER.format(candidate.startedAt)}`;
}

function fitLine(text: string, width: number): string {
  return truncateToWidth(text, Math.max(width, 0), "");
}

function joinReasons(parts: string[]): string {
  if (parts.length === 0) return "Broad summary match across session metadata";
  if (parts.length === 1)
    return `${parts[0][0]!.toUpperCase()}${parts[0].slice(1)}`;
  if (parts.length === 2)
    return `${parts[0][0]!.toUpperCase()}${parts[0].slice(1)} and ${parts[1]}`;
  return `${parts[0][0]!.toUpperCase()}${parts[0].slice(1)}, ${parts[1]}, and ${parts[2]}`;
}

function buildHeuristicWhy(
  candidate: SessionCandidate,
  query: string,
  keywords: string[],
): string {
  const searchTerms = createSearchTerms(query);
  const name = normalizeSearchString(candidate.name ?? "");
  const cwd = normalizeSearchString(candidate.cwd ?? "");
  const first = normalizeSearchString(candidate.firstUserMessage ?? "");
  const last = normalizeSearchString(candidate.lastUserMessage ?? "");
  const snippetMatches = selectRelevantSnippets(candidate, query, 1);
  const bestSnippet = snippetMatches[0];
  const reasons: string[] = [];

  if (
    searchTerms.normalizedQuery &&
    name.includes(searchTerms.normalizedQuery)
  ) {
    reasons.push("session name matches the query");
  }
  if (
    searchTerms.normalizedQuery &&
    cwd.includes(searchTerms.normalizedQuery)
  ) {
    reasons.push("project path matches the query");
  }
  if (
    searchTerms.normalizedQuery &&
    first.includes(searchTerms.normalizedQuery)
  ) {
    reasons.push("first user message matches the query");
  }
  if (
    searchTerms.normalizedQuery &&
    last.includes(searchTerms.normalizedQuery)
  ) {
    reasons.push("last user message matches the query");
  }
  if (
    searchTerms.normalizedQuery &&
    bestSnippet &&
    bestSnippet !== candidate.firstUserMessage &&
    bestSnippet !== candidate.lastUserMessage
  ) {
    reasons.push("a later user message matches the query");
  }

  if (reasons.length === 0) {
    const searchableFields = [
      name,
      cwd,
      first,
      last,
      ...candidate.userMessageSamples.map((snippet) =>
        normalizeSearchString(snippet),
      ),
    ];
    const matchedKeywords = keywords.filter((keyword) =>
      searchableFields.some((field) => field.includes(keyword)),
    );
    if (matchedKeywords.length > 0) {
      reasons.push(
        `keywords overlap (${matchedKeywords.slice(0, 3).join(", ")})`,
      );
    }
  }

  if (reasons.length === 0 && candidate.userMessageCount > 0) {
    reasons.push("session summary is the closest available match");
  }

  return joinReasons(reasons.slice(0, 3));
}

function scoreCandidate(
  candidate: SessionCandidate,
  query: string,
  keywords: string[],
): number {
  const searchTerms = createSearchTerms(query);
  const name = normalizeSearchString(candidate.name ?? "");
  const cwd = normalizeSearchString(candidate.cwd ?? "");
  const first = normalizeSearchString(candidate.firstUserMessage ?? "");
  const last = normalizeSearchString(candidate.lastUserMessage ?? "");
  const bestSnippetScore = Math.max(
    0,
    ...candidate.userMessageSamples.map((snippet) =>
      scoreSnippetMatch(snippet, searchTerms),
    ),
  );
  const nameWeight = candidate.name && candidate.name.length <= 80 ? 12 : 6;
  const keywordNameWeight =
    candidate.name && candidate.name.length <= 80 ? 5 : 2;

  let score = 0;
  if (searchTerms.normalizedQuery) {
    if (name.includes(searchTerms.normalizedQuery)) score += nameWeight;
    if (cwd.includes(searchTerms.normalizedQuery)) score += 10;
    if (first.includes(searchTerms.normalizedQuery)) score += 9;
    if (last.includes(searchTerms.normalizedQuery)) score += 6;
    score += Math.min(bestSnippetScore, 10);
  }

  for (const keyword of keywords) {
    if (name.includes(keyword)) score += keywordNameWeight;
    if (cwd.includes(keyword)) score += 4;
    if (first.includes(keyword)) score += 4;
    if (last.includes(keyword)) score += 3;
  }

  const recencyDays = Math.max(
    0,
    (Date.now() - candidate.startedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  score += Math.max(0, 3 - Math.min(recencyDays / 30, 3));

  return score;
}

function parseRankingResponse(text: string): RankingResponse | null {
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.unshift(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as RankingResponse;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function walkSessionFiles(
  root: string,
  signal?: AbortSignal,
  onFound?: (count: number) => void,
): Promise<string[]> {
  const files: string[] = [];
  let found = 0;

  const visit = async (dirPath: string): Promise<void> => {
    if (signal?.aborted) return;

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal?.aborted) return;
      if (entry.name === ".trash") continue;

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      files.push(fullPath);
      found += 1;
      onFound?.(found);
    }
  };

  await visit(root);
  files.sort((left, right) => right.localeCompare(left));
  return files;
}

async function parseSessionCandidate(
  filePath: string,
  signal?: AbortSignal,
): Promise<SessionCandidate | null> {
  const { reader, stream } = createLineReader(filePath);
  let cwd: string | null = null;
  let sessionId: string | null = null;
  let startedAt = parseSessionStartFromFilename(path.basename(filePath));
  let name: string | null = null;
  let firstUserMessage: string | null = null;
  let lastUserMessage: string | null = null;
  const userMessageSamples: string[] = [];
  const seenUserMessageSamples = new Set<string>();
  let userMessageCount = 0;

  try {
    for await (const line of reader) {
      if (signal?.aborted) return null;
      if (!line) continue;

      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed?.type === "session") {
        if (typeof parsed.cwd === "string") cwd = parsed.cwd;
        if (typeof parsed.id === "string") sessionId = parsed.id;
        if (typeof parsed.timestamp === "string") {
          const parsedTimestamp = new Date(parsed.timestamp);
          if (Number.isFinite(parsedTimestamp.getTime())) {
            startedAt = parsedTimestamp;
          }
        }
        continue;
      }

      if (parsed?.type === "session_info" && typeof parsed.name === "string") {
        name = sanitizeSessionName(parsed.name);
        continue;
      }

      if (parsed?.type !== "message" || parsed?.message?.role !== "user") {
        continue;
      }

      const text = extractTextContent(parsed.message.content);
      if (!text) continue;

      const preview = previewText(text);
      if (!firstUserMessage) firstUserMessage = preview;
      lastUserMessage = preview;

      const sampleKey = normalizeSearchString(preview);
      const canStoreSample =
        sampleKey &&
        !seenUserMessageSamples.has(sampleKey) &&
        userMessageSamples.length < MAX_STORED_USER_MESSAGE_SAMPLES;
      if (canStoreSample) {
        seenUserMessageSamples.add(sampleKey);
        userMessageSamples.push(preview);
      }

      userMessageCount += 1;
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  const effectiveStartedAt = startedAt ?? new Date(0);
  const searchText = normalizeSearchString(
    [name, cwd, firstUserMessage, lastUserMessage, ...userMessageSamples]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );

  return {
    filePath,
    relativePath: path.relative(SESSION_ROOT, filePath),
    sessionId,
    name,
    cwd,
    startedAt: effectiveStartedAt,
    firstUserMessage,
    lastUserMessage,
    userMessageSamples,
    userMessageCount,
    searchText,
  };
}

async function loadSessionCatalog(
  signal?: AbortSignal,
  onProgress?: (progress: SearchProgress) => void,
): Promise<SessionCandidate[]> {
  try {
    await fs.access(SESSION_ROOT);
  } catch {
    return [];
  }

  const files = await walkSessionFiles(SESSION_ROOT, signal, (count) => {
    onProgress?.({
      phase: "scan",
      message: `Scanning session files... ${count} found`,
    });
  });

  const sessions: SessionCandidate[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) break;
    const filePath = files[index]!;
    onProgress?.({
      phase: "parse",
      message: `Reading session summaries... ${index + 1}/${files.length}`,
    });

    const candidate = await parseSessionCandidate(filePath, signal);
    if (candidate) {
      sessions.push(candidate);
    }
  }

  sessions.sort(
    (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
  );
  return sessions;
}

function stripMatchedKeywordCount(
  candidates: Array<RankedSessionCandidate & { matchedKeywordCount: number }>,
): RankedSessionCandidate[] {
  return candidates.map(
    ({ matchedKeywordCount: _matchedKeywordCount, ...candidate }) => candidate,
  );
}

function shortlistCandidates(
  sessions: SessionCandidate[],
  queryHistory: string[],
): RankedSessionCandidate[] {
  const combinedQuery = normalizeQuery(queryHistory.join(" "));
  const keywords = extractKeywords(combinedQuery);

  const scored = sessions
    .map((candidate) => {
      const heuristicScore = scoreCandidate(candidate, combinedQuery, keywords);
      const matchedKeywordCount = countKeywordMatches(
        candidate.searchText,
        keywords,
      );
      return {
        ...candidate,
        matchedKeywordCount,
        heuristicScore,
        why: buildHeuristicWhy(candidate, combinedQuery, keywords),
        confidence: null,
      };
    })
    .sort((left, right) => {
      if (right.matchedKeywordCount !== left.matchedKeywordCount) {
        return right.matchedKeywordCount - left.matchedKeywordCount;
      }
      if (right.heuristicScore !== left.heuristicScore) {
        return right.heuristicScore - left.heuristicScore;
      }
      return right.startedAt.getTime() - left.startedAt.getTime();
    });

  if (keywords.length === 0 && combinedQuery.length === 0) {
    return stripMatchedKeywordCount(scored.slice(0, MAX_LLM_CANDIDATES));
  }

  const keywordFiltered = scored.filter(
    (candidate) => candidate.matchedKeywordCount > 0,
  );
  const fallback =
    keywordFiltered.length > 0
      ? keywordFiltered
      : scored.filter((candidate) => candidate.heuristicScore > 0);
  return stripMatchedKeywordCount(
    (fallback.length > 0 ? fallback : scored).slice(0, MAX_LLM_CANDIDATES),
  );
}

function buildPromptCandidates(
  candidates: RankedSessionCandidate[],
  queryHistory: string[],
) {
  const combinedQuery = normalizeQuery(queryHistory.join(" "));

  return candidates.map((candidate, index) => ({
    id: `c${index + 1}`,
    title: getDisplayName(candidate),
    name: candidate.name,
    project: getProjectLabel(candidate),
    cwd: toHomeRelative(candidate.cwd),
    startedAt: candidate.startedAt.toISOString(),
    firstUserMessage: candidate.firstUserMessage,
    lastUserMessage: candidate.lastUserMessage,
    relevantUserSnippets: selectRelevantSnippets(candidate, combinedQuery),
    userMessageCount: candidate.userMessageCount,
    heuristicHint: candidate.why,
  }));
}

async function rankSessionMatches(options: {
  queryHistory: string[];
  sessions: SessionCandidate[];
  model: NonNullable<ExtensionCommandContext["model"]>;
  modelRegistry: ExtensionCommandContext["modelRegistry"];
  signal?: AbortSignal;
  onProgress?: (progress: SearchProgress) => void;
}): Promise<RankedSessionCandidate[]> {
  const shortlist = shortlistCandidates(options.sessions, options.queryHistory);
  if (shortlist.length === 0) {
    return [];
  }

  const promptCandidates = buildPromptCandidates(
    shortlist,
    options.queryHistory,
  );
  const auth = await options.modelRegistry.getApiKeyAndHeaders(options.model);
  if (!auth.ok) {
    throw new Error(
      auth.error || `No API key available for ${options.model.id}`,
    );
  }

  options.onProgress?.({
    phase: "rank",
    message: `Ranking ${promptCandidates.length} candidates with ${options.model.name ?? options.model.id}...`,
  });

  const systemPrompt = [
    "You rank Pi coding-agent sessions for resume search.",
    "",
    "Use the user's query history plus the candidate summaries to choose only sessions that are plausibly the right match.",
    "Prioritize exact project matches and intent matches in the first user message.",
    "Use the last user message as a secondary clue. Use recency only as a light tie breaker.",
    "",
    "Exclude weak, tangential, or near-miss candidates.",
    "If a candidate only shares one vague word, leave it out.",
    "If none are strong matches, return an empty results array.",
    "The why field must be positive-only, explaining why the result is likely correct.",
    "Do not explain why a result is wrong, incomplete, or off-topic.",
    "",
    "Return strict JSON with this shape:",
    '{"results":[{"id":"c1","why":"short positive explanation","confidence":92}]}',
    "",
    `Rules: return at most ${MAX_RESULTS} results, only use ids from the provided candidates, keep each why under 120 characters, and use confidence 0-100 where 100 means extremely likely correct.`,
  ].join("\n");

  const userPrompt = [
    "Query history, oldest first:",
    ...options.queryHistory.map((query, index) => `${index + 1}. ${query}`),
    "",
    "Candidate sessions:",
    JSON.stringify(promptCandidates, null, 2),
  ].join("\n");

  const response = await completeSimple(
    options.model,
    {
      systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: userPrompt }],
          timestamp: Date.now(),
        },
      ],
    },
    { apiKey: auth.apiKey, headers: auth.headers, signal: options.signal },
  );

  const responseText = response.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();

  const parsed = parseRankingResponse(responseText);
  if (!parsed?.results?.length) {
    return shortlist.slice(0, MAX_RESULTS);
  }

  const byId = new Map(
    promptCandidates.map((candidate, index) => [
      candidate.id,
      shortlist[index]!,
    ]),
  );
  const ranked: RankedSessionCandidate[] = [];
  for (const result of parsed.results) {
    if (!result?.id) continue;
    const candidate = byId.get(result.id);
    if (!candidate) continue;

    const why = normalizeWhitespace(result.why || candidate.why);
    const confidence =
      typeof result.confidence === "number" ? result.confidence : null;

    if (confidence !== null && confidence < MIN_RESULT_CONFIDENCE) continue;
    if (isNegativeMatchExplanation(why)) continue;

    ranked.push({
      ...candidate,
      why,
      confidence,
    });
    if (ranked.length >= MAX_RESULTS) break;
  }

  return ranked;
}

class FindSessionComponent implements Component, Focusable {
  private readonly tui: TUI;
  private readonly theme: SearchTheme;
  private readonly keybindings: KeybindingsManager;
  private readonly model: NonNullable<ExtensionCommandContext["model"]>;
  private readonly modelRegistry: ExtensionCommandContext["modelRegistry"];
  private readonly onDone: (value: FindSessionSelection | null) => void;
  private readonly input = new Input();

  private sessions: SessionCandidate[] = [];
  private results: RankedSessionCandidate[] = [];
  private queryHistory: string[] = [];
  private lastSearchInput = "";
  private busy = true;
  private busyMessage = "Opening session search...";
  private errorMessage: string | null = null;
  private selectedIndex = 0;
  private activeController: AbortController | null = null;
  private _focused = false;

  constructor(options: FindSessionComponentOptions) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.model = options.model;
    this.modelRegistry = options.modelRegistry;
    this.onDone = options.onDone;
    this.input.setValue(options.initialQuery);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  start(): void {
    void this.initialize();
  }

  invalidate(): void {
    this.input.invalidate();
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close();
      return;
    }

    if (matchesKey(data, "ctrl+l")) {
      this.clearSearch();
      this.tui.requestRender();
      return;
    }

    if (this.busy) {
      return;
    }

    if (
      this.results.length > 0 &&
      this.keybindings.matches(data, "tui.select.up")
    ) {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.results.length - 1
          : this.selectedIndex - 1;
      this.tui.requestRender();
      return;
    }

    if (
      this.results.length > 0 &&
      this.keybindings.matches(data, "tui.select.down")
    ) {
      this.selectedIndex =
        this.selectedIndex === this.results.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.tui.requestRender();
      return;
    }

    if (
      this.results.length > 0 &&
      this.keybindings.matches(data, "tui.select.pageUp")
    ) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 5);
      this.tui.requestRender();
      return;
    }

    if (
      this.results.length > 0 &&
      this.keybindings.matches(data, "tui.select.pageDown")
    ) {
      this.selectedIndex = Math.min(
        this.results.length - 1,
        this.selectedIndex + 5,
      );
      this.tui.requestRender();
      return;
    }

    if (
      this.keybindings.matches(data, "tui.select.confirm") ||
      this.keybindings.matches(data, "tui.input.submit")
    ) {
      const draft = normalizeQuery(this.input.getValue());
      if (!draft) {
        return;
      }

      if (draft !== this.lastSearchInput || this.results.length === 0) {
        void this.search(draft);
        return;
      }

      const selected = this.results[this.selectedIndex];
      if (selected) {
        this.onDone({ sessionPath: selected.filePath });
      }
      return;
    }

    const before = this.input.getValue();
    this.input.handleInput(data);
    if (this.input.getValue() !== before) {
      this.errorMessage = null;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    const lines: string[] = [];
    const heading = `${this.theme.fg("accent", this.theme.bold("Session Search"))}`;
    lines.push(fitLine(heading, width));
    lines.push("");

    if (this.busy || this.errorMessage) {
      const statusColor = this.errorMessage ? "error" : "warning";
      lines.push(
        fitLine(
          this.theme.fg(statusColor, this.errorMessage || this.busyMessage),
          width,
        ),
      );
      lines.push("");
    } else if (this.sessions.length === 0) {
      lines.push(
        fitLine(
          this.theme.fg(
            "warning",
            `No saved sessions found under ${toHomeRelative(SESSION_ROOT)}`,
          ),
          width,
        ),
      );
      lines.push("");
    } else {
      lines.push(
        fitLine(
          this.theme.fg(
            "muted",
            `Indexed ${this.sessions.length} sessions. Press Enter to search, then Enter again to resume the highlighted match.`,
          ),
          width,
        ),
      );
      lines.push("");
    }

    const previousQueries = this.queryHistory.slice(0, -1);
    if (previousQueries.length > 0) {
      lines.push(fitLine(this.theme.fg("muted", "Previous queries:"), width));
      for (const query of previousQueries.slice(-3)) {
        lines.push(fitLine(`  ${query}`, width));
      }
      lines.push("");
    }

    lines.push(fitLine(this.theme.fg("muted", "Query"), width));
    for (const line of this.input.render(width)) {
      lines.push(fitLine(line, width));
    }
    lines.push("");

    if (this.results.length === 0) {
      const emptyState = this.lastSearchInput
        ? `No strong matches for "${this.lastSearchInput}". Refine the query and press Enter again.`
        : "Type a query, press Enter to search, use arrows to choose a result, then press Enter again to resume.";
      lines.push(fitLine(this.theme.fg("dim", emptyState), width));
      lines.push("");
    } else {
      lines.push(
        fitLine(
          this.theme.fg(
            "muted",
            `Results (${this.results.length}, ranked from ${this.sessions.length} indexed sessions):`,
          ),
          width,
        ),
      );
      lines.push("");

      for (let index = 0; index < this.results.length; index += 1) {
        const result = this.results[index]!;
        const selected = index === this.selectedIndex;
        const pointer = selected ? this.theme.fg("accent", ">") : " ";
        const number = selected
          ? this.theme.fg("accent", `${index + 1}.`)
          : this.theme.fg("muted", `${index + 1}.`);
        const title = selected
          ? this.theme.bold(getDisplayName(result))
          : getDisplayName(result);
        const date = this.theme.fg(
          "dim",
          `[${DATE_FORMATTER.format(result.startedAt)}]`,
        );
        const snippet =
          selectRelevantSnippets(result, this.lastSearchInput, 1)[0] ??
          result.firstUserMessage ??
          result.lastUserMessage ??
          "No user message preview available";
        const projectLine = `${getProjectLabel(result)} | ${toHomeRelative(result.cwd)}`;
        const whyLine = `Match: ${result.why}`;

        lines.push(fitLine(`${pointer} ${number} ${title} ${date}`, width));
        lines.push(fitLine(`    ${previewText(projectLine, 80)}`, width));
        lines.push(fitLine(`    \"${previewText(snippet, 80)}\"`, width));
        lines.push(fitLine(`    ${previewText(whyLine, 100)}`, width));
        lines.push("");
      }
    }

    const draft = normalizeQuery(this.input.getValue());
    const enterAction =
      draft && draft === this.lastSearchInput && this.results.length > 0
        ? "resume"
        : "search";
    const help = [
      `Enter ${enterAction}`,
      "Up/Down select",
      "Ctrl+L clear",
      "Esc exit",
    ].join("  •  ");
    lines.push(fitLine(this.theme.fg("dim", help), width));

    return lines;
  }

  private async initialize(): Promise<void> {
    this.busy = true;
    this.errorMessage = null;
    this.cancelActiveController();
    const controller = new AbortController();
    this.activeController = controller;
    this.busyMessage = "Scanning session history...";
    this.tui.requestRender();

    try {
      this.sessions = await loadSessionCatalog(
        controller.signal,
        (progress) => {
          this.busyMessage = progress.message;
          this.tui.requestRender();
        },
      );
      this.busy = false;
      this.activeController = null;
      this.tui.requestRender();

      const initialQuery = normalizeQuery(this.input.getValue());
      if (initialQuery) {
        await this.search(initialQuery);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      this.busy = false;
      this.activeController = null;
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
      this.tui.requestRender();
    }
  }

  private async search(query: string): Promise<void> {
    if (!query) return;
    if (this.sessions.length === 0) {
      this.lastSearchInput = query;
      this.results = [];
      this.tui.requestRender();
      return;
    }

    if (this.queryHistory[this.queryHistory.length - 1] !== query) {
      this.queryHistory.push(query);
    }

    this.busy = true;
    this.errorMessage = null;
    this.cancelActiveController();
    const controller = new AbortController();
    this.activeController = controller;
    this.busyMessage = `Preparing candidate shortlist for \"${query}\"...`;
    this.tui.requestRender();

    try {
      const ranked = await rankSessionMatches({
        queryHistory: this.queryHistory,
        sessions: this.sessions,
        model: this.model,
        modelRegistry: this.modelRegistry,
        signal: controller.signal,
        onProgress: (progress) => {
          this.busyMessage = progress.message;
          this.tui.requestRender();
        },
      });

      if (controller.signal.aborted) return;
      this.results = ranked;
      this.lastSearchInput = query;
      this.selectedIndex = 0;
      this.busy = false;
      this.activeController = null;
      this.tui.requestRender();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.busy = false;
      this.activeController = null;
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
      this.tui.requestRender();
    }
  }

  private clearSearch(): void {
    this.cancelActiveController();
    this.queryHistory = [];
    this.lastSearchInput = "";
    this.results = [];
    this.selectedIndex = 0;
    this.errorMessage = null;
    this.busy = false;
    this.input.setValue("");
  }

  private close(): void {
    this.cancelActiveController();
    this.onDone(null);
  }

  private cancelActiveController(): void {
    if (!this.activeController) return;
    this.activeController.abort();
    this.activeController = null;
  }
}

export default function findSessionExtension(pi: ExtensionAPI): void {
  pi.registerCommand("find-session", {
    description:
      "Search saved Pi sessions with LLM ranking and resume the best match",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/find-session requires interactive mode", "error");
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("/find-session requires an active model", "error");
        return;
      }

      const initialQuery = normalizeQuery(args ?? "");
      const selection = await ctx.ui.custom<FindSessionSelection | null>(
        (tui, theme, keybindings, done) => {
          const component = new FindSessionComponent({
            tui,
            theme: theme as SearchTheme,
            keybindings,
            model: ctx.model!,
            modelRegistry: ctx.modelRegistry,
            initialQuery,
            onDone: done,
          });
          component.start();
          return component;
        },
      );

      if (!selection) {
        return;
      }

      try {
        await fs.access(selection.sessionPath);
      } catch {
        ctx.ui.notify(
          `Session file no longer exists: ${selection.sessionPath}`,
          "error",
        );
        return;
      }

      await ctx.waitForIdle();
      const result = await ctx.switchSession(selection.sessionPath);
      if (result.cancelled) {
        ctx.ui.notify("Session switch cancelled", "info");
      }
    },
  });
}

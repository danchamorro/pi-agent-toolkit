/**
 * Exa Search Tool
 *
 * Registers a callable `exa_search` tool that wraps the exa-search skill's
 * helper script via pi.exec(). Works in all modes including question-mode
 * and plan-mode since it does not depend on bash.
 *
 * Supports all 5 Exa endpoints: search, contents, findsimilar, answer, research.
 * Renders a compact, non-interactive stats card for completed searches.
 *
 * Shortcut: none.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";

// ── Script resolution ─────────────────────────────────────────────────
const SCRIPT_CANDIDATES = [
	join(homedir(), ".pi", "agent", "skills", "exa-search", "scripts", "exa-api.cjs"),
	join(homedir(), ".agents", "skills", "exa-search", "scripts", "exa-api.cjs"),
];

function resolveScript(): string | undefined {
	return SCRIPT_CANDIDATES.find((p) => existsSync(p));
}

// ── Schema ────────────────────────────────────────────────────────────
const ExaSearchParams = Type.Object({
	endpoint: StringEnum(
		["search", "contents", "findsimilar", "answer", "research"] as const,
		{ description: "Exa API endpoint to call" },
	),
	query: Type.Optional(
		Type.String({ description: "Search query (search, answer, research endpoints)" }),
	),
	url: Type.Optional(
		Type.String({ description: "URL to find similar pages for (findsimilar endpoint)" }),
	),
	ids: Type.Optional(
		Type.Array(Type.String(), { description: "Result IDs to fetch content for (contents endpoint)" }),
	),
	numResults: Type.Optional(
		Type.Number({ description: "Number of results to return (default: 10)" }),
	),
	type: Type.Optional(
		StringEnum(["auto", "neural", "fast", "deep"] as const, {
			description: "Search type (default: auto)",
		}),
	),
	category: Type.Optional(
		Type.String({
			description: "Category filter: company, people, research paper, news, pdf, github, tweet",
		}),
	),
	includeDomains: Type.Optional(
		Type.Array(Type.String(), { description: "Restrict results to these domains" }),
	),
	excludeDomains: Type.Optional(
		Type.Array(Type.String(), { description: "Exclude results from these domains" }),
	),
	startPublishedDate: Type.Optional(
		Type.String({ description: "Filter results published after this ISO date (e.g. 2025-01-01)" }),
	),
	endPublishedDate: Type.Optional(
		Type.String({ description: "Filter results published before this ISO date" }),
	),
	includeText: Type.Optional(
		Type.Array(Type.String(), { description: "Pages must contain these strings" }),
	),
	excludeText: Type.Optional(
		Type.Array(Type.String(), { description: "Pages must not contain these strings" }),
	),
	text: Type.Optional(
		Type.Boolean({ description: "Include full text in results (default: true for search)" }),
	),
	highlights: Type.Optional(
		Type.Boolean({ description: "Include highlights in results" }),
	),
	summary: Type.Optional(
		Type.Boolean({ description: "Include summary in results" }),
	),
	input: Type.Optional(
		Type.String({ description: "Research question (research endpoint)" }),
	),
});

// ── Payload builders ──────────────────────────────────────────────────

interface Params {
	endpoint: string;
	query?: string;
	url?: string;
	ids?: string[];
	numResults?: number;
	type?: string;
	category?: string;
	includeDomains?: string[];
	excludeDomains?: string[];
	startPublishedDate?: string;
	endPublishedDate?: string;
	includeText?: string[];
	excludeText?: string[];
	text?: boolean;
	highlights?: boolean;
	summary?: boolean;
	input?: string;
}

function buildPayload(params: Params): Record<string, unknown> {
	const { endpoint } = params;

	switch (endpoint) {
		case "search":
			return {
				query: params.query,
				type: params.type ?? "auto",
				numResults: params.numResults ?? 10,
				...(params.category && { category: params.category }),
				...(params.includeDomains?.length && { includeDomains: params.includeDomains }),
				...(params.excludeDomains?.length && { excludeDomains: params.excludeDomains }),
				...(params.startPublishedDate && { startPublishedDate: params.startPublishedDate }),
				...(params.endPublishedDate && { endPublishedDate: params.endPublishedDate }),
				...(params.includeText?.length && { includeText: params.includeText }),
				...(params.excludeText?.length && { excludeText: params.excludeText }),
				contents: {
					text: params.text ?? true,
					highlights: params.highlights ?? true,
					summary: params.summary ?? true,
				},
			};

		case "contents":
			return {
				ids: params.ids ?? [],
				text: params.text ?? true,
				highlights: params.highlights ?? false,
				summary: params.summary ?? true,
			};

		case "findsimilar":
			return {
				url: params.url,
				numResults: params.numResults ?? 10,
				...(params.category && { category: params.category }),
				...(params.includeDomains?.length && { includeDomains: params.includeDomains }),
				...(params.excludeDomains?.length && { excludeDomains: params.excludeDomains }),
				...(params.startPublishedDate && { startPublishedDate: params.startPublishedDate }),
				contents: {
					text: params.text ?? true,
					summary: params.summary ?? true,
				},
			};

		case "answer":
			return {
				query: params.query,
				numResults: params.numResults ?? 5,
				...(params.includeDomains?.length && { includeDomains: params.includeDomains }),
				...(params.excludeDomains?.length && { excludeDomains: params.excludeDomains }),
			};

		case "research":
			return {
				input: params.input ?? params.query,
				model: "auto",
				stream: false,
				citation_format: "numbered",
			};

		default:
			return {};
	}
}

// ── Result formatting ─────────────────────────────────────────────────

interface ExaResult {
	title?: string;
	url?: string;
	text?: string;
	summary?: string;
	highlights?: string[];
	score?: number;
	publishedDate?: string;
	id?: string;
}

interface ExaResponse {
	results?: ExaResult[];
	answer?: string;
	context?: string;
	data?: unknown;
	costDollars?: number;
	requestId?: string;
	searchType?: string;
}

function formatResultsForLLM(endpoint: string, response: ExaResponse): string {
	const parts: string[] = [];

	if (endpoint === "answer" && response.answer) {
		parts.push(response.answer);
		if (response.context) {
			parts.push("", "Sources:", response.context);
		}
	} else if (endpoint === "research") {
		if (response.data) {
			parts.push(JSON.stringify(response.data, null, 2));
		} else {
			parts.push(JSON.stringify(response, null, 2));
		}
	} else if (response.results && response.results.length > 0) {
		for (let i = 0; i < response.results.length; i++) {
			const r = response.results[i];
			const num = i + 1;
			parts.push(`[${num}] ${r.title ?? "(no title)"}`);
			if (r.url) parts.push(`    ${r.url}`);
			if (r.publishedDate) parts.push(`    Published: ${r.publishedDate}`);
			if (r.summary) parts.push(`    ${r.summary}`);
			if (r.text) {
				const preview = r.text.length > 500 ? r.text.slice(0, 500) + "..." : r.text;
				parts.push(`    ${preview}`);
			}
			if (r.highlights && r.highlights.length > 0) {
				parts.push(`    Highlights: ${r.highlights.join(" | ")}`);
			}
			parts.push("");
		}
	} else {
		parts.push("No results found.");
	}

	if (response.costDollars != null) {
		const cost = Number(response.costDollars);
		parts.push(`[Cost: $${Number.isFinite(cost) ? cost.toFixed(4) : response.costDollars}]`);
	}

	return parts.join("\n");
}

// ── Details for rendering & state ─────────────────────────────────────

interface ExaSearchDetails {
	endpoint: string;
	query?: string;
	url?: string;
	resultCount: number;
	requestedCount?: number;
	cost?: number;
	searchType?: string;
	domains?: Array<{ domain: string; count: number }>;
	freshness?: Array<{ label: string; count: number }>;
	content?: {
		text: number;
		summaries: number;
		highlights: number;
		total: number;
	};
	filters?: string[];
	sourceRequestCount?: number;
	hasAnswer?: boolean;
	hasResearchData?: boolean;
}

function getRequestedCount(params: Params): number | undefined {
	switch (params.endpoint) {
		case "search":
		case "findsimilar":
			return params.numResults ?? 10;
		case "contents":
			return params.ids?.length ?? 0;
		default:
			return undefined;
	}
}

function getSourceRequestCount(params: Params): number | undefined {
	return params.endpoint === "answer" ? (params.numResults ?? 5) : undefined;
}

function getDomain(url: string): string | undefined {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return undefined;
	}
}

function summarizeDomains(results: ExaResult[] = []): Array<{ domain: string; count: number }> {
	const counts = new Map<string, number>();
	for (const result of results) {
		if (!result.url) continue;
		const domain = getDomain(result.url);
		if (!domain) continue;
		counts.set(domain, (counts.get(domain) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([domain, count]) => ({ domain, count }))
		.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
		.slice(0, 4);
}

function summarizeFreshness(results: ExaResult[] = []): Array<{ label: string; count: number }> {
	const currentYear = new Date().getFullYear();
	const counts = new Map<string, number>([
		[String(currentYear), 0],
		[String(currentYear - 1), 0],
		["older", 0],
		["unknown", 0],
	]);

	for (const result of results) {
		const year = result.publishedDate ? new Date(result.publishedDate).getFullYear() : Number.NaN;
		if (!Number.isFinite(year)) {
			counts.set("unknown", (counts.get("unknown") ?? 0) + 1);
		} else if (year === currentYear || year === currentYear - 1) {
			const label = String(year);
			counts.set(label, (counts.get(label) ?? 0) + 1);
		} else {
			counts.set("older", (counts.get("older") ?? 0) + 1);
		}
	}

	return [...counts.entries()]
		.filter(([, count]) => count > 0)
		.map(([label, count]) => ({ label, count }));
}

function summarizeContent(results: ExaResult[] = []): ExaSearchDetails["content"] {
	return {
		text: results.filter((result) => Boolean(result.text)).length,
		summaries: results.filter((result) => Boolean(result.summary)).length,
		highlights: results.filter((result) => (result.highlights?.length ?? 0) > 0).length,
		total: results.length,
	};
}

function summarizeFilters(params: Params): string[] {
	const filters: string[] = [];
	if (params.includeDomains?.length) filters.push(`include ${params.includeDomains.join(", ")}`);
	if (params.excludeDomains?.length) filters.push(`exclude ${params.excludeDomains.join(", ")}`);
	if (params.startPublishedDate) filters.push(`after ${params.startPublishedDate}`);
	if (params.endPublishedDate) filters.push(`before ${params.endPublishedDate}`);
	if (params.category) filters.push(`category ${params.category}`);
	return filters;
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatCost(cost: number | undefined): string | undefined {
	if (cost == null) return undefined;
	const numericCost = Number(cost);
	return Number.isFinite(numericCost) ? `$${numericCost.toFixed(4)}` : `$${cost}`;
}

function formatResultBar(resultCount: number, requestedCount: number | undefined): string {
	const width = 10;
	const denominator = requestedCount && requestedCount > 0 ? requestedCount : Math.max(resultCount, 1);
	const filled = Math.max(0, Math.min(width, Math.round((resultCount / denominator) * width)));
	return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function getHeaderStatus(details: ExaSearchDetails): string {
	if (details.endpoint === "answer") return details.hasAnswer ? "answer ready" : "no answer";
	if (details.endpoint === "research") return details.hasResearchData ? "research complete" : "no research data";
	return details.resultCount === 1 ? "1 result" : `${details.resultCount} results`;
}

function addProgressLine(lines: string[], details: ExaSearchDetails): void {
	if (details.endpoint === "answer") {
		const sources = details.sourceRequestCount;
		lines.push(sources ? `Sources   requested ${sources}` : "Sources   requested default");
		return;
	}

	if (details.endpoint === "research") {
		lines.push(`Status    ${details.hasResearchData ? "complete" : "empty"}`);
		return;
	}

	const requested = details.requestedCount;
	const countLabel = requested != null ? `${details.resultCount}/${requested}` : String(details.resultCount);
	lines.push(`Results   [${formatResultBar(details.resultCount, requested)}] ${countLabel}`);
}

function formatStatsCard(details: ExaSearchDetails): string[] {
	const cost = formatCost(details.cost);
	const headerParts = [`Exa ${details.endpoint}`, getHeaderStatus(details), cost].filter(Boolean);

	const lines = [headerParts.join("  ")];
	if (details.query) lines.push(`Query     ${truncate(details.query, 76)}`);
	addProgressLine(lines, details);
	if (details.searchType) lines.push(`Profile   ${details.endpoint}:${details.searchType}`);

	if (details.domains?.length) {
		lines.push(
			truncate(
				`Domains   ${details.domains.map((entry) => `${entry.domain} ${entry.count}`).join(" | ")}`,
				96,
			),
		);
	}

	if (details.freshness?.length) {
		lines.push(`Freshness ${details.freshness.map((entry) => `${entry.label} ${entry.count}`).join(" | ")}`);
	}

	if (details.content && details.content.total > 0) {
		const content = details.content;
		lines.push(
			truncate(
				`Content   text ${content.text}/${content.total} | summaries ${content.summaries}/${content.total} | highlights ${content.highlights}/${content.total}`,
				96,
			),
		);
	}

	if (details.filters?.length) {
		lines.push(`Filters   ${truncate(details.filters.join(" | "), 76)}`);
	}

	return lines;
}

// ── Extension ─────────────────────────────────────────────────────────

export default function exaSearchTool(pi: ExtensionAPI): void {
	const scriptPath = resolveScript();

	if (!scriptPath) {
		// Skill not installed -- skip tool registration silently
		return;
	}

	pi.registerTool({
		name: "exa_search",
		label: "Exa Search",
		description:
			"Web search, content extraction, similar-page discovery, direct answers, " +
			"and structured research via the Exa API. Use instead of bash-based web fetching.",

		promptSnippet:
			"Semantic web search, find similar pages, get direct answers, or run structured research via Exa",

		promptGuidelines: [
			"Use exa_search for all web search, documentation lookup, and research tasks.",
			"Prefer the 'search' endpoint with includeDomains for official docs verification.",
			"Use 'answer' for direct factual questions, 'research' for structured synthesis.",
			"Use 'findsimilar' when the user provides a reference URL and wants related pages.",
			"Use 'contents' to fetch full text for result IDs from a previous search.",
		],

		parameters: ExaSearchParams,

		async execute(_toolCallId, params, signal, onUpdate) {
			if (signal?.aborted) {
				throw new Error("Exa search was cancelled");
			}

			const { endpoint } = params;
			const label = endpoint === "findsimilar" ? "find similar" : endpoint;
			const queryPreview = params.query ?? params.url ?? params.input ?? "(no query)";

			onUpdate?.({
				content: [{ type: "text", text: `Searching Exa (${label}): ${queryPreview}` }],
				details: undefined,
			});

			const payload = buildPayload(params);
			const payloadJson = JSON.stringify(payload);

			const result = await pi.exec("node", [scriptPath, endpoint, payloadJson], {
				signal,
				timeout: 65_000,
			});

			if (result.killed) {
				throw new Error("Exa search timed out");
			}

			if (result.code !== 0) {
				const errorMsg = (result.stderr || result.stdout || "Unknown error").trim();
				throw new Error(`Exa API error: ${errorMsg}`);
			}

			let response: ExaResponse;
			try {
				response = JSON.parse(result.stdout);
			} catch {
				throw new Error(`Failed to parse Exa response: ${result.stdout.slice(0, 200)}`);
			}

			const formatted = formatResultsForLLM(endpoint, response);
			const resultCount =
				endpoint === "research" && response.data
					? 1
					: response.results?.length ?? (response.answer ? 1 : 0);
			const results = response.results ?? [];

			return {
				content: [{ type: "text", text: formatted }],
				details: {
					endpoint,
					query: params.query ?? params.url ?? params.input,
					resultCount,
					requestedCount: getRequestedCount(params),
					cost: response.costDollars,
					searchType: response.searchType ?? params.type,
					domains: summarizeDomains(results),
					freshness: summarizeFreshness(results),
					content: summarizeContent(results),
					filters: summarizeFilters(params),
					sourceRequestCount: getSourceRequestCount(params),
					hasAnswer: Boolean(response.answer),
					hasResearchData: Boolean(response.data),
				} satisfies ExaSearchDetails,
			};
		},

		renderCall(args, theme) {
			const endpoint = args.endpoint ?? "search";
			const query = args.query ?? args.url ?? args.input ?? "";
			let text = theme.fg("toolTitle", theme.bold("exa "));
			text += theme.fg("accent", endpoint);
			if (query) {
				const preview = query.length > 60 ? query.slice(0, 60) + "..." : query;
				text += " " + theme.fg("muted", preview);
			}
			if (args.includeDomains?.length) {
				text += " " + theme.fg("dim", `[${args.includeDomains.join(", ")}]`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Searching..."), 0, 0);
			}

			const details = result.details as ExaSearchDetails | undefined;
			if (!details || !details.endpoint) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
			}

			let text = formatStatsCard(details)
				.map((line, index) => (index === 0 ? theme.fg("success", line) : theme.fg("dim", line)))
				.join("\n");

			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					text += "\n\n" + theme.fg("dim", content.text);
				}
			}

			return new Text(text, 0, 0);
		},
	});
}

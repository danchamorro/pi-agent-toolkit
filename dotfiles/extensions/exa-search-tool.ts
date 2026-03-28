/**
 * Exa Search Tool
 *
 * Registers a callable `exa_search` tool that wraps the exa-search skill's
 * helper script via pi.exec(). Works in all modes including question-mode
 * and plan-mode since it does not depend on bash.
 *
 * Supports all 5 Exa endpoints: search, contents, findsimilar, answer, research.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

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
	cost?: number;
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
			const resultCount = response.results?.length ?? (response.answer ? 1 : 0);

			return {
				content: [{ type: "text", text: formatted }],
				details: {
					endpoint,
					query: params.query ?? params.url ?? params.input,
					resultCount,
					cost: response.costDollars,
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

			const countLabel =
				details.resultCount === 1
					? "1 result"
					: `${details.resultCount} results`;

			let text = theme.fg("success", countLabel);
			text += " " + theme.fg("muted", `(${details.endpoint})`);

			if (details.cost != null) {
				const cost = Number(details.cost);
				text += " " + theme.fg("dim", `[$${Number.isFinite(cost) ? cost.toFixed(4) : details.cost}]`);
			}

			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					text += "\n" + theme.fg("dim", content.text);
				}
			}

			return new Text(text, 0, 0);
		},
	});
}

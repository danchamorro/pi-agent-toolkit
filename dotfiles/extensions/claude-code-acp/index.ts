/**
 * Claude Code ACP Extension
 *
 * Shortcut: none.
 * Slash commands: none.
 *
 * Registers an experimental text-only Pi provider that sends rendered Pi
 * conversation context to a Claude Code ACP agent process. The default ACP
 * command is `npx -y @agentclientprotocol/claude-agent-acp@0.31.4`; Claude Code login and
 * subscription billing remain outside Pi. Tool, filesystem, terminal, and MCP
 * passthrough are intentionally disabled for this milestone.
 */

import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mapAcpStopReason, runAcpTextPrompt } from "./acp-client.ts";
import { describeClaudeCodeAcpCommand, loadClaudeCodeAcpConfig } from "./config.ts";
import { renderContextAsAcpPrompt } from "./context-renderer.ts";

const PROVIDER_ID = "claude-code-acp";
const API_ID = "claude-code-acp";

interface ClaudeCodeAcpModelRoute {
	id: string;
	name: string;
	modelPreference?: string;
}

interface ClaudeCodeAcpProviderModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: ["text"];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

const DEFAULT_MODEL_ROUTE: ClaudeCodeAcpModelRoute = {
	id: "default",
	name: "Claude Code via ACP (adapter default, experimental)",
};

const MODEL_ROUTES: ClaudeCodeAcpModelRoute[] = [
	DEFAULT_MODEL_ROUTE,
	{
		id: "sonnet-4-6",
		name: "Claude Code via ACP (Sonnet 4.6 requested, experimental)",
		modelPreference: "claude-sonnet-4-6",
	},
	{
		id: "sonnet-4-5",
		name: "Claude Code via ACP (Sonnet 4.5 requested, experimental)",
		modelPreference: "claude-sonnet-4-5",
	},
	{
		id: "opus-4-7-1m",
		name: "Claude Code via ACP (Opus 4.7 1M requested, experimental)",
		modelPreference: "opus[1m]",
	},
	{
		id: "opus-4-7",
		name: "Claude Code via ACP (Opus 4.7 requested, experimental)",
		modelPreference: "claude-opus-4-7",
	},
	{
		id: "opus-4-6",
		name: "Claude Code via ACP (Opus 4.6 requested, experimental)",
		modelPreference: "claude-opus-4-6",
	},
	{
		id: "haiku-4-5",
		name: "Claude Code via ACP (Haiku 4.5 requested, experimental)",
		modelPreference: "claude-haiku-4-5",
	},
];

function getModelRoute(modelId: string): ClaudeCodeAcpModelRoute {
	return MODEL_ROUTES.find((route) => route.id === modelId) ?? DEFAULT_MODEL_ROUTE;
}

function describeModelRoute(route: ClaudeCodeAcpModelRoute): string {
	if (!route.modelPreference) return `${PROVIDER_ID}/${route.id}`;
	return `${PROVIDER_ID}/${route.id} -> ANTHROPIC_MODEL=${route.modelPreference}`;
}

function toProviderModel(route: ClaudeCodeAcpModelRoute): ClaudeCodeAcpProviderModel {
	return {
		id: route.id,
		name: route.name,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	};
}

function streamClaudeCodeAcp(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	void (async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		let textIndex: number | undefined;
		let textClosed = false;
		let commandDescription = "npx -y @agentclientprotocol/claude-agent-acp";
		let routeDescription = model.id;

		const closeTextBlock = () => {
			if (textIndex === undefined || textClosed) return;
			const block = output.content[textIndex];
			if (block?.type === "text") {
				stream.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: output });
				textClosed = true;
			}
		};

		try {
			stream.push({ type: "start", partial: output });

			const config = loadClaudeCodeAcpConfig();
			const route = getModelRoute(model.id);
			commandDescription = describeClaudeCodeAcpCommand(config);
			routeDescription = describeModelRoute(route);
			const prompt = renderContextAsAcpPrompt(context);
			const result = await runAcpTextPrompt({
				config,
				cwd: process.cwd(),
				prompt,
				modelSelection: {
					routeId: route.id,
					modelPreference: route.modelPreference,
				},
				signal: options?.signal,
				callbacks: {
					onText: (delta) => {
						if (!delta) return;
						if (textIndex === undefined) {
							output.content.push({ type: "text", text: "" });
							textIndex = output.content.length - 1;
							stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
						}

						const block = output.content[textIndex];
						if (block?.type !== "text") {
							throw new Error("Internal claude-code-acp stream state error: expected text block.");
						}

						block.text += delta;
						stream.push({ type: "text_delta", contentIndex: textIndex, delta, partial: output });
					},
					onDebug: (message) => {
						process.stderr.write(`${message}\n`);
					},
				},
			});

			const stopReason = mapAcpStopReason(result.stopReason, options?.signal?.aborted ?? false);
			output.stopReason = stopReason;
			closeTextBlock();

			if (stopReason === "aborted") {
				throw new Error("Claude Code ACP request was aborted.");
			}
			if (stopReason === "error") {
				throw new Error(`Claude Code ACP stopped with reason ${result.stopReason}.`);
			}

			stream.push({ type: "done", reason: stopReason, message: output });
			stream.end();
		} catch (error) {
			closeTextBlock();
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			const message = error instanceof Error ? error.message : String(error);
			output.errorMessage = `${message}\n\nACP route: ${routeDescription}\nACP command: ${commandDescription}`;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

export default function (pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER_ID, {
		baseUrl: "acp://claude-code",
		apiKey: "not-used",
		api: API_ID,
		models: MODEL_ROUTES.map(toProviderModel),
		streamSimple: streamClaudeCodeAcp,
	});
}

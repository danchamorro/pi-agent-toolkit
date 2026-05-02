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
const MODEL_ID = "claude-code-acp";
const API_ID = "claude-code-acp";

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
			commandDescription = describeClaudeCodeAcpCommand(config);
			const prompt = renderContextAsAcpPrompt(context);
			const result = await runAcpTextPrompt({
				config,
				cwd: process.cwd(),
				prompt,
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
			output.errorMessage = `${message}\n\nACP command: ${commandDescription}`;
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
		models: [
			{
				id: MODEL_ID,
				name: "Claude Code via ACP (experimental)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 64_000,
			},
		],
		streamSimple: streamClaudeCodeAcp,
	});
}

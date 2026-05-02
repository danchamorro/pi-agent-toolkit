import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import type { ClaudeCodeAcpConfig } from "./config.ts";

const JSON_RPC_VERSION = "2.0";
const ACP_PROTOCOL_VERSION = 1;
const METHOD_NOT_FOUND = -32601;
const PROCESS_EXIT_GRACE_MS = 1_000;
const STDERR_LIMIT = 8_000;

interface JsonRpcRequest {
	jsonrpc: typeof JSON_RPC_VERSION;
	id: number | string;
	method: string;
	params?: unknown;
}

interface JsonRpcNotification {
	jsonrpc: typeof JSON_RPC_VERSION;
	method: string;
	params?: unknown;
}

interface JsonRpcSuccessResponse {
	jsonrpc: typeof JSON_RPC_VERSION;
	id: number | string;
	result?: unknown;
}

interface JsonRpcErrorResponse {
	jsonrpc: typeof JSON_RPC_VERSION;
	id: number | string | null;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface InitializeResponse {
	protocolVersion?: number;
	agentInfo?: {
		name?: string;
		title?: string;
		version?: string;
	};
	agentCapabilities?: Record<string, unknown>;
	authMethods?: Array<{ id?: string; name?: string; type?: string }>;
}

interface NewSessionResponse {
	sessionId: string;
	models?: {
		currentModelId?: string;
		availableModels?: Array<{ modelId?: string; name?: string; description?: string }>;
	};
	modes?: {
		currentModeId?: string;
		availableModes?: Array<{ id?: string; name?: string }>;
	};
	configOptions?: Array<{
		id?: string;
		name?: string;
		currentValue?: unknown;
		options?: Array<{ value?: string; name?: string }>;
	}>;
}

interface PromptResponse {
	stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
}

interface SessionNotification {
	sessionId?: string;
	update?: SessionUpdate;
}

type SessionUpdate =
	| {
			sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk";
			content?: { type?: string; text?: string };
		}
	| {
			sessionUpdate: "tool_call" | "tool_call_update";
			title?: string | null;
			toolCallId?: string;
		}
	| {
			sessionUpdate:
				| "plan"
				| "available_commands_update"
				| "current_mode_update"
				| "config_option_update"
				| "session_info_update"
				| "usage_update";
		};

export interface AcpPromptCallbacks {
	onText(delta: string): void;
	onDebug?(message: string): void;
}

export interface AcpPromptResult {
	stopReason: PromptResponse["stopReason"];
}

export async function runAcpTextPrompt(params: {
	config: ClaudeCodeAcpConfig;
	cwd: string;
	prompt: string;
	signal?: AbortSignal;
	callbacks: AcpPromptCallbacks;
}): Promise<AcpPromptResult> {
	const client = new MinimalAcpClient(params.config, params.cwd, params.callbacks);
	return await client.runPrompt(params.prompt, params.signal);
}

class MinimalAcpClient {
	private child: ChildProcessWithoutNullStreams | undefined;
	private nextId = 1;
	private readonly pending = new Map<
		number | string,
		{
			resolve(value: unknown): void;
			reject(error: Error): void;
		}
	>();
	private sessionId: string | undefined;
	private stderr = "";
	private closed = false;
	private fatalError: Error | undefined;

	constructor(
		private readonly config: ClaudeCodeAcpConfig,
		private readonly cwd: string,
		private readonly callbacks: AcpPromptCallbacks,
	) {}

	async runPrompt(prompt: string, signal?: AbortSignal): Promise<AcpPromptResult> {
		this.spawnChild();

		const timeout = setTimeout(() => {
			this.fail(new Error(`Claude Code ACP timed out after ${this.config.timeoutMs} ms.`));
			void this.cancelAndClose();
		}, this.config.timeoutMs);

		const abort = () => {
			this.fail(new Error("Claude Code ACP request was aborted."));
			void this.cancelAndClose();
		};

		if (signal?.aborted) abort();
		signal?.addEventListener("abort", abort, { once: true });

		try {
			const initialize = await this.sendRequest<InitializeResponse>("initialize", {
				protocolVersion: ACP_PROTOCOL_VERSION,
				clientInfo: {
					name: "pi-claude-code-acp",
					version: "0.1.0",
				},
				clientCapabilities: {},
			});
			this.debugInitializeSummary(initialize);

			const session = await this.sendRequest<NewSessionResponse>("session/new", {
				cwd: resolve(this.cwd),
				mcpServers: [],
				_meta: {
					claudeCode: {
						options: {
							tools: [],
						},
					},
				},
			});
			this.sessionId = session.sessionId;
			this.debugSessionSummary(session);

			const response = await this.sendRequest<PromptResponse>("session/prompt", {
				sessionId: this.sessionId,
				prompt: [{ type: "text", text: prompt }],
			});

			if (this.fatalError) throw this.fatalError;
			return { stopReason: response.stopReason };
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			await this.closeProcess();
		}
	}

	private spawnChild(): void {
		this.debug(`Starting ACP command: ${this.config.command} ${this.config.args.join(" ")}`);
		this.child = spawn(this.config.command, this.config.args, {
			cwd: this.cwd,
			env: process.env,
			stdio: "pipe",
		});

		let stdoutBuffer = "";
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => {
			stdoutBuffer += chunk;
			let newlineIndex = stdoutBuffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = stdoutBuffer.slice(0, newlineIndex).trim();
				stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
				if (line) this.handleLine(line);
				newlineIndex = stdoutBuffer.indexOf("\n");
			}
		});

		this.child.stderr.setEncoding("utf8");
		this.child.stderr.on("data", (chunk: string) => {
			this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_LIMIT);
			this.debug(`stderr: ${chunk.trim()}`);
		});

		this.child.on("error", (error) => this.fail(error));
		this.child.on("exit", (code, signal) => {
			this.closed = true;
			if (this.pending.size > 0 && !this.fatalError) {
				const detail = this.stderr.trim() ? ` stderr: ${this.stderr.trim()}` : "";
				this.fail(new Error(`Claude Code ACP process exited before completing. code=${code} signal=${signal}.${detail}`));
			}
		});
	}

	private handleLine(line: string): void {
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(line) as JsonRpcMessage;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.fail(new Error(`Claude Code ACP emitted invalid JSON-RPC: ${detail}`));
			return;
		}

		if ("id" in message && ("result" in message || "error" in message)) {
			this.handleResponse(message as JsonRpcSuccessResponse | JsonRpcErrorResponse);
			return;
		}

		if ("id" in message && "method" in message) {
			void this.handleRequest(message as JsonRpcRequest);
			return;
		}

		if ("method" in message) {
			this.handleNotification(message as JsonRpcNotification);
		}
	}

	private handleResponse(message: JsonRpcSuccessResponse | JsonRpcErrorResponse): void {
		if (message.id === null) return;

		const pending = this.pending.get(message.id);
		if (!pending) return;

		this.pending.delete(message.id);
		if ("error" in message) {
			pending.reject(new Error(`${message.error.message} (${message.error.code})`));
		} else {
			pending.resolve(message.result);
		}
	}

	private async handleRequest(message: JsonRpcRequest): Promise<void> {
		if (message.method === "session/request_permission") {
			this.debug("Denying ACP permission request because tool passthrough is disabled.");
			this.sendResponse(message.id, { outcome: { outcome: "cancelled" } });
			return;
		}

		this.debug(`Rejecting unsupported ACP client request: ${message.method}`);
		this.sendError(message.id, METHOD_NOT_FOUND, `Pi claude-code-acp does not support ${message.method}.`);
	}

	private handleNotification(message: JsonRpcNotification): void {
		if (message.method !== "session/update") {
			this.debug(`Ignoring ACP notification: ${message.method}`);
			return;
		}

		const notification = message.params as SessionNotification | undefined;
		const update = notification?.update;
		if (!update) return;

		if (update.sessionUpdate === "agent_message_chunk") {
			if (update.content?.type === "text" && update.content.text) {
				this.callbacks.onText(update.content.text);
			} else {
				this.debug("Ignoring non-text ACP agent message chunk.");
			}
			return;
		}

		if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
			const title = typeof update.title === "string" && update.title ? `: ${update.title}` : "";
			this.fail(new Error(`Claude Code ACP attempted a tool call${title}. Tool passthrough is disabled.`));
			void this.cancelAndClose();
			return;
		}

		this.debug(`Ignoring ACP session update: ${update.sessionUpdate}`);
	}

	private sendRequest<T>(method: string, params: unknown): Promise<T> {
		if (this.fatalError) return Promise.reject(this.fatalError);
		if (!this.child || this.closed) return Promise.reject(new Error("Claude Code ACP process is not running."));

		const id = this.nextId++;
		const request: JsonRpcRequest = { jsonrpc: JSON_RPC_VERSION, id, method, params };
		return new Promise<T>((resolvePromise, rejectPromise) => {
			this.pending.set(id, {
				resolve: (value) => resolvePromise(value as T),
				reject: rejectPromise,
			});
			this.writeMessage(request);
		});
	}

	private sendResponse(id: number | string, result: unknown): void {
		this.writeMessage({ jsonrpc: JSON_RPC_VERSION, id, result });
	}

	private sendError(id: number | string, code: number, message: string): void {
		this.writeMessage({ jsonrpc: JSON_RPC_VERSION, id, error: { code, message } });
	}

	private writeMessage(message: JsonRpcRequest | JsonRpcSuccessResponse | JsonRpcErrorResponse): void {
		if (!this.child || this.closed) return;

		try {
			this.child.stdin.write(`${JSON.stringify(message)}\n`);
		} catch (error) {
			const detail = error instanceof Error ? error : new Error(String(error));
			this.fail(detail);
		}
	}

	private fail(error: Error): void {
		if (!this.fatalError) this.fatalError = error;
		for (const [id, pending] of this.pending) {
			pending.reject(error);
			this.pending.delete(id);
		}
	}

	private async cancelAndClose(): Promise<void> {
		if (this.sessionId && this.child && !this.closed) {
			const id = this.nextId++;
			this.writeMessage({
				jsonrpc: JSON_RPC_VERSION,
				id,
				method: "session/cancel",
				params: { sessionId: this.sessionId },
			});
		}

		await this.closeProcess();
	}

	private async closeProcess(): Promise<void> {
		if (!this.child || this.closed) return;

		this.child.stdin.end();
		this.child.kill("SIGTERM");

		const killTimer = setTimeout(() => {
			if (this.child && !this.closed) this.child.kill("SIGKILL");
		}, PROCESS_EXIT_GRACE_MS);

		await once(this.child, "exit");
		clearTimeout(killTimer);
	}

	private debugInitializeSummary(response: InitializeResponse): void {
		const capabilities = Object.keys(response.agentCapabilities ?? {}).sort();
		const authMethods = (response.authMethods ?? [])
			.map((method) => formatSummaryParts(method.id, method.name, method.type))
			.filter(isNonEmptyString);
		this.debug(
			`initialize: protocolVersion=${response.protocolVersion ?? "unknown"} ` +
				`agent=${response.agentInfo?.name ?? "unknown"}@${response.agentInfo?.version ?? "unknown"} ` +
				`capabilities=${formatList(capabilities)} authMethods=${formatList(authMethods)}`,
		);
	}

	private debugSessionSummary(response: NewSessionResponse): void {
		const models = response.models?.availableModels ?? [];
		const modelSummary = models
			.slice(0, 12)
			.map((model) => formatSummaryParts(model.modelId, model.name))
			.filter(isNonEmptyString);
		const configOptions = (response.configOptions ?? [])
			.map((option) => `${option.id ?? "unknown"}=${formatConfigValue(option.currentValue)}`)
			.filter(Boolean);
		const modes = (response.modes?.availableModes ?? [])
			.map((mode) => formatSummaryParts(mode.id, mode.name))
			.filter(isNonEmptyString);
		const remainingModels = Math.max(0, models.length - modelSummary.length);
		const modelSuffix = remainingModels > 0 ? ` +${remainingModels} more` : "";

		this.debug(
			`session/new: sessionId=${response.sessionId} currentModel=${response.models?.currentModelId ?? "unknown"} ` +
				`availableModels=${formatList(modelSummary)}${modelSuffix} ` +
				`currentMode=${response.modes?.currentModeId ?? "unknown"} availableModes=${formatList(modes)} ` +
				`configOptions=${formatList(configOptions)}`,
		);
	}

	private debug(message: string): void {
		if (this.config.debug) this.callbacks.onDebug?.(`[claude-code-acp] ${message}`);
	}
}

function formatList(values: string[]): string {
	return values.length > 0 ? values.join(",") : "none";
}

function formatSummaryParts(...parts: Array<string | undefined>): string {
	return parts.filter(isNonEmptyString).join("/");
}

function isNonEmptyString(value: string | undefined): value is string {
	return Boolean(value);
}

function formatConfigValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null || value === undefined) return "unset";
	return "set";
}

export function mapAcpStopReason(
	stopReason: AcpPromptResult["stopReason"],
	aborted: boolean,
): "stop" | "length" | "error" | "aborted" {
	if (aborted) return "aborted";
	if (stopReason === "cancelled") return "error";
	if (stopReason === "max_tokens" || stopReason === "max_turn_requests") return "length";
	if (stopReason === "end_turn" || stopReason === "refusal") return "stop";
	return "error";
}

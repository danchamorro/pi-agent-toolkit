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
	stopReason: string;
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

export interface AcpModelSelection {
	routeId: string;
	modelPreference?: string;
}

export async function runAcpTextPrompt(params: {
	config: ClaudeCodeAcpConfig;
	cwd: string;
	prompt: string;
	modelSelection: AcpModelSelection;
	signal?: AbortSignal;
	callbacks: AcpPromptCallbacks;
}): Promise<AcpPromptResult> {
	const client = new MinimalAcpClient(params.config, params.cwd, params.callbacks, params.modelSelection);
	return await client.runPrompt(params.prompt, params.signal);
}

class MinimalAcpClient {
	private child: ChildProcessWithoutNullStreams | undefined;
	private nextId = 1;
	private readonly pending = new Map<
		number | string,
		{
			method: string;
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
		private readonly modelSelection: AcpModelSelection,
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
			const initialize = validateInitializeResponse(
				await this.sendRequest("initialize", {
					protocolVersion: ACP_PROTOCOL_VERSION,
					clientInfo: {
						name: "pi-claude-code-acp",
						version: "0.1.0",
					},
					clientCapabilities: {},
				}),
			);
			this.debugInitializeSummary(initialize);

			const session = validateNewSessionResponse(
				await this.sendRequest("session/new", {
					cwd: resolve(this.cwd),
					mcpServers: [],
					_meta: {
						claudeCode: {
							options: {
								tools: [],
							},
						},
					},
				}),
			);
			this.sessionId = session.sessionId;
			this.debugSessionSummary(session);

			const response = validatePromptResponse(
				await this.sendRequest("session/prompt", {
					sessionId: this.sessionId,
					prompt: [{ type: "text", text: prompt }],
				}),
			);

			if (this.fatalError) throw this.fatalError;
			return { stopReason: response.stopReason };
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			await this.closeProcess();
		}
	}

	private spawnChild(): void {
		this.debug(
			`Starting ACP command: ${this.config.command} ${this.config.args.join(" ")} ` +
				`route=${this.modelSelection.routeId} requestedModel=${this.modelSelection.modelPreference ?? "adapter-default"}`,
		);
		const env = {
			...process.env,
			...(this.modelSelection.modelPreference ? { ANTHROPIC_MODEL: this.modelSelection.modelPreference } : {}),
		};
		this.child = spawn(this.config.command, this.config.args, {
			cwd: this.cwd,
			env,
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
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.fail(new Error(`Claude Code ACP emitted malformed JSON: ${detail}`));
			return;
		}

		const message = validateJsonRpcMessage(parsed);
		if (message instanceof Error) {
			this.fail(message);
			return;
		}

		if (isJsonRpcResponse(message)) {
			this.handleResponse(message);
			return;
		}

		if ("id" in message) {
			void this.handleRequest(message);
			return;
		}

		this.handleNotification(message);
	}

	private handleResponse(message: JsonRpcSuccessResponse | JsonRpcErrorResponse): void {
		if (message.id === null) return;

		const pending = this.pending.get(message.id);
		if (!pending) return;

		this.pending.delete(message.id);
		if ("error" in message) {
			pending.reject(
				this.protocolError(
					`ACP ${pending.method} failed: ${message.error.message} (${message.error.code})${formatErrorData(message.error.data)}`,
				),
			);
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

		const notification = validateSessionNotification(message.params);
		if (notification instanceof Error) {
			this.fail(notification);
			void this.cancelAndClose();
			return;
		}

		const update = notification.update;
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
			this.fail(this.protocolError(`Claude Code ACP attempted a tool call${title}. Tool passthrough is disabled.`));
			void this.cancelAndClose();
			return;
		}

		this.debug(`Ignoring ACP session update: ${update.sessionUpdate}`);
	}

	private sendRequest(method: string, params: unknown): Promise<unknown> {
		if (this.fatalError) return Promise.reject(this.fatalError);
		if (!this.child || this.closed) return Promise.reject(new Error("Claude Code ACP process is not running."));

		const id = this.nextId++;
		const request: JsonRpcRequest = { jsonrpc: JSON_RPC_VERSION, id, method, params };
		return new Promise<unknown>((resolvePromise, rejectPromise) => {
			this.pending.set(id, {
				method,
				resolve: resolvePromise,
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

	private protocolError(message: string): Error {
		return new Error(
			`${message} route=${this.modelSelection.routeId} ` +
				`requestedModel=${this.modelSelection.modelPreference ?? "adapter-default"}`,
		);
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

function validateJsonRpcMessage(value: unknown): JsonRpcMessage | Error {
	if (!isRecord(value)) return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: message must be an object.");
	if (value.jsonrpc !== JSON_RPC_VERSION) {
		return new Error('Claude Code ACP emitted invalid JSON-RPC envelope: jsonrpc must be "2.0".');
	}

	const hasId = "id" in value;
	const hasMethod = "method" in value;
	const hasResult = "result" in value;
	const hasError = "error" in value;
	if (hasId && !isJsonRpcId(value.id)) return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: invalid id.");

	if (hasMethod) {
		if (typeof value.method !== "string" || !value.method) {
			return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: method must be a non-empty string.");
		}
		if (hasResult || hasError) return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: method cannot include result or error.");
		return value as unknown as JsonRpcRequest | JsonRpcNotification;
	}

	if (hasId && (hasResult || hasError)) {
		if (hasResult && hasError) return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: response has result and error.");
		if (hasError && !isJsonRpcErrorObject(value.error)) {
			return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: invalid error object.");
		}
		return value as unknown as JsonRpcSuccessResponse | JsonRpcErrorResponse;
	}

	return new Error("Claude Code ACP emitted invalid JSON-RPC envelope: expected request, notification, or response.");
}

function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcSuccessResponse | JsonRpcErrorResponse {
	return "id" in message && ("result" in message || "error" in message);
}

function validateInitializeResponse(value: unknown): InitializeResponse {
	if (!isRecord(value)) throw new Error("ACP initialize returned invalid response: expected object.");
	if ("protocolVersion" in value && typeof value.protocolVersion !== "number") {
		throw new Error("ACP initialize returned invalid response: protocolVersion must be a number.");
	}
	if ("agentInfo" in value && value.agentInfo !== undefined && !isRecord(value.agentInfo)) {
		throw new Error("ACP initialize returned invalid response: agentInfo must be an object.");
	}
	if ("agentCapabilities" in value && value.agentCapabilities !== undefined && !isRecord(value.agentCapabilities)) {
		throw new Error("ACP initialize returned invalid response: agentCapabilities must be an object.");
	}
	if ("authMethods" in value && value.authMethods !== undefined && !Array.isArray(value.authMethods)) {
		throw new Error("ACP initialize returned invalid response: authMethods must be an array.");
	}
	return value as InitializeResponse;
}

function validateNewSessionResponse(value: unknown): NewSessionResponse {
	if (!isRecord(value)) throw new Error("ACP session/new returned invalid response: expected object.");
	if (typeof value.sessionId !== "string" || !value.sessionId) {
		throw new Error("ACP session/new returned invalid response: sessionId must be a non-empty string.");
	}
	if ("models" in value && value.models !== undefined && !isRecord(value.models)) {
		throw new Error("ACP session/new returned invalid response: models must be an object.");
	}
	if (isRecord(value.models) && "availableModels" in value.models && !isOptionalArray(value.models.availableModels)) {
		throw new Error("ACP session/new returned invalid response: models.availableModels must be an array.");
	}
	if ("modes" in value && value.modes !== undefined && !isRecord(value.modes)) {
		throw new Error("ACP session/new returned invalid response: modes must be an object.");
	}
	if (isRecord(value.modes) && "availableModes" in value.modes && !isOptionalArray(value.modes.availableModes)) {
		throw new Error("ACP session/new returned invalid response: modes.availableModes must be an array.");
	}
	if ("configOptions" in value && !isOptionalArray(value.configOptions)) {
		throw new Error("ACP session/new returned invalid response: configOptions must be an array.");
	}
	return value as unknown as NewSessionResponse;
}

function validatePromptResponse(value: unknown): PromptResponse {
	if (!isRecord(value)) throw new Error("ACP session/prompt returned invalid response: expected object.");
	if (typeof value.stopReason !== "string" || !value.stopReason) {
		throw new Error("ACP session/prompt returned invalid response: stopReason must be a non-empty string.");
	}
	return value as unknown as PromptResponse;
}

function validateSessionNotification(value: unknown): SessionNotification | Error {
	if (!isRecord(value)) return new Error("ACP session/update notification was invalid: params must be an object.");
	if ("sessionId" in value && value.sessionId !== undefined && typeof value.sessionId !== "string") {
		return new Error("ACP session/update notification was invalid: sessionId must be a string.");
	}
	if (!("update" in value) || value.update === undefined) return value as SessionNotification;
	if (!isRecord(value.update)) return new Error("ACP session/update notification was invalid: update must be an object.");
	const update = value.update;
	if (typeof update.sessionUpdate !== "string" || !update.sessionUpdate) {
		return new Error("ACP session/update notification was invalid: sessionUpdate must be a non-empty string.");
	}

	if (isChunkSessionUpdate(update.sessionUpdate)) {
		const contentError = validateChunkContent(update);
		if (contentError) return contentError;
		return value as SessionNotification;
	}

	if (isToolCallSessionUpdate(update.sessionUpdate)) {
		const titleError = validateToolCallTitle(update);
		if (titleError) return titleError;
		return value as SessionNotification;
	}

	return value as SessionNotification;
}

function isChunkSessionUpdate(sessionUpdate: string): boolean {
	return ["agent_message_chunk", "agent_thought_chunk", "user_message_chunk"].includes(sessionUpdate);
}

function validateChunkContent(update: Record<string, unknown>): Error | undefined {
	if (!("content" in update) || update.content === undefined) return undefined;
	if (!isRecord(update.content)) return new Error("ACP session/update chunk was invalid: content must be an object.");
	if ("type" in update.content && update.content.type !== undefined && typeof update.content.type !== "string") {
		return new Error("ACP session/update chunk was invalid: content.type must be a string.");
	}
	if ("text" in update.content && update.content.text !== undefined && typeof update.content.text !== "string") {
		return new Error("ACP session/update chunk was invalid: content.text must be a string.");
	}
	return undefined;
}

function isToolCallSessionUpdate(sessionUpdate: string): boolean {
	return sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update";
}

function validateToolCallTitle(update: Record<string, unknown>): Error | undefined {
	if (!("title" in update) || update.title === undefined || update.title === null) return undefined;
	if (typeof update.title === "string") return undefined;
	return new Error("ACP session/update tool call was invalid: title must be a string or null.");
}

function isJsonRpcId(value: unknown): value is number | string | null {
	return typeof value === "number" || typeof value === "string" || value === null;
}

function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorResponse["error"] {
	return isRecord(value) && typeof value.code === "number" && typeof value.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalArray(value: unknown): boolean {
	return value === undefined || Array.isArray(value);
}

function formatErrorData(value: unknown): string {
	if (value === undefined) return "";
	try {
		return ` data=${JSON.stringify(value)}`;
	} catch {
		return " data=[unserializable]";
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

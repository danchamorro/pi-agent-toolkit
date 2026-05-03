import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import type { ClaudeCodeAcpConfig } from "./config.ts";

const JSON_RPC_VERSION = "2.0";
const ACP_PROTOCOL_VERSION = 1;
const METHOD_NOT_FOUND = -32601;
const PROCESS_EXIT_GRACE_MS = 1_000;
const STDERR_LIMIT = 8_000;
const PERSIST_IDLE_GRACE_MS = 5_000;
const CHUNK_SESSION_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "user_message_chunk"]);
const TOOL_CALL_SESSION_UPDATES = new Set(["tool_call", "tool_call_update"]);

type TranscriptFieldValue = string | number | boolean | undefined;

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

export interface AcpTextPromptParams {
	config: ClaudeCodeAcpConfig;
	cwd: string;
	prompt: string;
	modelSelection: AcpModelSelection;
	signal?: AbortSignal;
	callbacks: AcpPromptCallbacks;
}

export async function runAcpTextPrompt(params: AcpTextPromptParams): Promise<AcpPromptResult> {
	if (params.config.persist) return await persistentAcpClients.runPrompt(params);

	const client = new MinimalAcpClient(params.config, params.cwd, params.callbacks, params.modelSelection);
	return await client.runPrompt(params.prompt, params.signal, true);
}

interface PersistentAcpEntry {
	client: MinimalAcpClient;
	queue: Promise<void>;
	idleTimer: NodeJS.Timeout | undefined;
}

class PersistentAcpClientManager {
	private readonly entries = new Map<string, PersistentAcpEntry>();
	private cleanupHooksRegistered = false;

	async runPrompt(params: AcpTextPromptParams): Promise<AcpPromptResult> {
		this.registerCleanupHooks();
		const key = getPersistentClientKey(params);
		const entry = this.getOrCreateEntry(key, params);
		entry.client.transcriptEvent("persist_queue", { keyHash: hashString(key) });

		const run = entry.queue.then(async () => {
			this.clearIdleTimer(entry);
			entry.client.setCallbacks(params.callbacks);
			entry.client.transcriptEvent("persist_reuse", { keyHash: hashString(key), healthy: entry.client.isHealthy() });
			try {
				const result = await entry.client.runPrompt(params.prompt, params.signal, false);
				if (!entry.client.isHealthy()) await this.discard(key, entry, "unhealthy_after_prompt");
				return result;
			} catch (error) {
				await this.discard(key, entry, "prompt_error");
				throw error;
			}
		});

		entry.queue = run.then(
			() => {
				if (this.entries.get(key) === entry) this.scheduleIdleShutdown(key, entry);
			},
			() => undefined,
		);
		return await run;
	}

	private getOrCreateEntry(key: string, params: AcpTextPromptParams): PersistentAcpEntry {
		const existing = this.entries.get(key);
		if (existing?.client.canReuse()) return existing;
		if (existing) void this.discard(key, existing, "unhealthy_on_acquire");

		const entry: PersistentAcpEntry = {
			client: new MinimalAcpClient(params.config, params.cwd, params.callbacks, params.modelSelection),
			queue: Promise.resolve(),
			idleTimer: undefined,
		};
		entry.client.transcriptEvent("persist_acquire", { keyHash: hashString(key) });
		this.entries.set(key, entry);
		return entry;
	}

	private async discard(key: string, entry: PersistentAcpEntry, reason: string): Promise<void> {
		this.clearIdleTimer(entry);
		if (this.entries.get(key) === entry) this.entries.delete(key);
		entry.client.transcriptEvent("persist_discard", { keyHash: hashString(key), reason });
		await entry.client.shutdown(reason);
	}

	private scheduleIdleShutdown(key: string, entry: PersistentAcpEntry): void {
		this.clearIdleTimer(entry);
		entry.client.transcriptEvent("persist_idle", { keyHash: hashString(key), graceMs: PERSIST_IDLE_GRACE_MS });
		entry.idleTimer = setTimeout(() => {
			this.discard(key, entry, "idle").catch(() => undefined);
		}, PERSIST_IDLE_GRACE_MS);
	}

	private clearIdleTimer(entry: PersistentAcpEntry): void {
		if (!entry.idleTimer) return;
		clearTimeout(entry.idleTimer);
		entry.idleTimer = undefined;
	}

	private registerCleanupHooks(): void {
		if (this.cleanupHooksRegistered) return;
		this.cleanupHooksRegistered = true;
		process.once("beforeExit", () => {
			void this.shutdownAll("beforeExit");
		});
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
			process.once(signal, () => {
				void this.shutdownAll(signal).finally(() => process.kill(process.pid, signal));
			});
		}
	}

	private async shutdownAll(reason: string): Promise<void> {
		const entries = [...this.entries.entries()];
		this.entries.clear();
		await Promise.all(
			entries.map(([, entry]) => {
				this.clearIdleTimer(entry);
				return entry.client.shutdown(reason).catch(() => undefined);
			}),
		);
	}
}

const persistentAcpClients = new PersistentAcpClientManager();

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
	private initialized = false;
	private fatalError: Error | undefined;

	constructor(
		private readonly config: ClaudeCodeAcpConfig,
		private readonly cwd: string,
		private callbacks: AcpPromptCallbacks,
		private readonly modelSelection: AcpModelSelection,
	) {}

	setCallbacks(callbacks: AcpPromptCallbacks): void {
		this.callbacks = callbacks;
	}

	transcriptEvent(event: string, fields: Record<string, TranscriptFieldValue> = {}): void {
		this.transcript(event, fields);
	}

	isHealthy(): boolean {
		return Boolean(this.child) && !this.closed && !this.fatalError;
	}

	canReuse(): boolean {
		return !this.closed && !this.fatalError;
	}

	async runPrompt(prompt: string, signal?: AbortSignal, closeAfterPrompt = true): Promise<AcpPromptResult> {
		await this.ensureStartedAndInitialized();

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
			const session = validateNewSessionResponse(await this.sendRequest("session/new", createSessionNewParams(this.cwd)));
			this.sessionId = session.sessionId;
			this.debugSessionSummary(session);

			const response = validatePromptResponse(
				await this.sendRequest("session/prompt", {
					sessionId: this.sessionId,
					prompt: [{ type: "text", text: prompt }],
				}),
			);
			this.transcript("prompt_complete", { stopReason: response.stopReason });

			if (this.fatalError) throw this.fatalError;
			return { stopReason: response.stopReason };
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			this.sessionId = undefined;
			if (closeAfterPrompt) await this.closeProcess();
		}
	}

	async shutdown(reason = "requested"): Promise<void> {
		this.transcript("persist_shutdown", { reason });
		await this.closeProcess();
	}

	private async ensureStartedAndInitialized(): Promise<void> {
		if (!this.child || this.closed) this.spawnChild();
		if (this.initialized) return;

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
		this.initialized = true;
		this.debugInitializeSummary(initialize);
	}

	private spawnChild(): void {
		this.debug(
			`Starting ACP command: ${this.config.command} ${this.config.args.join(" ")} ` +
				`route=${this.modelSelection.routeId} requestedModel=${formatRequestedModel(this.modelSelection)}`,
		);
		const env = createChildEnv(this.modelSelection);
		this.transcript("process_start", {
			command: this.config.command,
			args: this.config.args.length,
			anthropicModelOverride: Boolean(this.modelSelection.modelPreference),
		});
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
			this.transcript("stderr", { bytes: Buffer.byteLength(chunk, "utf8"), lines: countLines(chunk) });
		});

		this.child.on("error", (error) => {
			this.transcript("process_error", { errorName: error.name, messageLength: error.message.length });
			this.fail(error);
		});
		this.child.on("exit", (code, signal) => {
			this.closed = true;
			this.initialized = false;
			this.sessionId = undefined;
			this.transcript("process_exit", { code: code ?? "null", signal: signal ?? "null", pending: this.pending.size });
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
			this.transcript("recv_malformed_json", { errorName: error instanceof Error ? error.name : "Error", bytes: Buffer.byteLength(line, "utf8") });
			this.fail(new Error(`Claude Code ACP emitted malformed JSON: ${detail}`));
			return;
		}

		const message = validateJsonRpcMessage(parsed);
		if (message instanceof Error) {
			this.transcript("recv_invalid_jsonrpc", { messageLength: message.message.length });
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
		this.transcript("recv_response", {
			id: message.id,
			method: pending.method,
			status: "error" in message ? "error" : "ok",
			result: "error" in message ? undefined : summarizeResult(pending.method, message.result),
			errorCode: "error" in message ? message.error.code : undefined,
			errorMessage: "error" in message ? message.error.message : undefined,
		});
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
		this.transcript("recv_request", { id: message.id, method: message.method, params: summarizeParams(message.method, message.params) });
		if (message.method === "session/request_permission") {
			this.debug("Denying ACP permission request because tool passthrough is disabled.");
			this.sendResponse(message.id, { outcome: { outcome: "cancelled" } });
			return;
		}

		this.debug(`Rejecting unsupported ACP client request: ${message.method}`);
		this.sendError(message.id, METHOD_NOT_FOUND, `Pi claude-code-acp does not support ${message.method}.`);
	}

	private handleNotification(message: JsonRpcNotification): void {
		this.transcript("recv_notification", { method: message.method, update: summarizeSessionUpdate(message.params) });
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
		this.transcript("send_request", { id, method, params: summarizeParams(method, params) });
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
		this.transcript("send_response", { id, status: "ok", result: summarizeResult("client/response", result) });
		this.writeMessage({ jsonrpc: JSON_RPC_VERSION, id, result });
	}

	private sendError(id: number | string, code: number, message: string): void {
		this.transcript("send_response", { id, status: "error", errorCode: code, errorMessage: message });
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
		this.transcript("fail", { errorName: error.name, messageLength: error.message.length, pending: this.pending.size });
		if (!this.fatalError) this.fatalError = error;
		for (const [id, pending] of this.pending) {
			pending.reject(error);
			this.pending.delete(id);
		}
	}

	private protocolError(message: string): Error {
		return new Error(`${message} route=${this.modelSelection.routeId} requestedModel=${formatRequestedModel(this.modelSelection)}`);
	}

	private async cancelAndClose(): Promise<void> {
		this.transcript("cancel_and_close", { hasSession: Boolean(this.sessionId), closed: this.closed });
		if (this.sessionId && this.child && !this.closed) {
			const id = this.nextId++;
			this.transcript("send_request", { id, method: "session/cancel", params: "sessionId=present" });
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
		if (!this.child) return;
		if (this.closed) {
			this.child = undefined;
			return;
		}

		this.transcript("close_process", { action: "sigterm" });
		this.child.stdin.end();
		this.child.kill("SIGTERM");

		const killTimer = setTimeout(() => {
			if (this.child && !this.closed) this.child.kill("SIGKILL");
		}, PROCESS_EXIT_GRACE_MS);

		await once(this.child, "exit");
		clearTimeout(killTimer);
		this.child = undefined;
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

	private transcript(event: string, fields: Record<string, TranscriptFieldValue> = {}): void {
		if (!this.config.debugTranscript) return;
		const shared = {
			route: this.modelSelection.routeId,
			requestedModel: formatRequestedModel(this.modelSelection),
			...fields,
		};
		this.callbacks.onDebug?.(`[claude-code-acp:transcript] ${event}${formatTranscriptFields(shared)}`);
	}

	private debug(message: string): void {
		if (this.config.debug) this.callbacks.onDebug?.(`[claude-code-acp] ${message}`);
	}
}

function createChildEnv(modelSelection: AcpModelSelection): NodeJS.ProcessEnv {
	return {
		...process.env,
		...(modelSelection.modelPreference ? { ANTHROPIC_MODEL: modelSelection.modelPreference } : {}),
	};
}

function formatRequestedModel(modelSelection: AcpModelSelection): string {
	return modelSelection.modelPreference ?? "adapter-default";
}

function createSessionNewParams(cwd: string): Record<string, unknown> {
	return {
		cwd: resolve(cwd),
		mcpServers: [],
		_meta: {
			claudeCode: {
				options: {
					tools: [],
				},
			},
		},
	};
}

function getPersistentClientKey(params: AcpTextPromptParams): string {
	return JSON.stringify({
		command: params.config.command,
		args: params.config.args,
		cwd: resolve(params.cwd),
		routeId: params.modelSelection.routeId,
		modelPreference: params.modelSelection.modelPreference ?? "",
	});
}

function hashString(value: string): string {
	let hash = 0;
	for (let i = 0; i < value.length; i += 1) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}
	return hash.toString(16);
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
	return CHUNK_SESSION_UPDATES.has(sessionUpdate);
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
	return TOOL_CALL_SESSION_UPDATES.has(sessionUpdate);
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

function summarizeParams(method: string, params: unknown): string {
	if (!isRecord(params)) return params === undefined ? "none" : typeof params;
	if (method === "session/prompt") return summarizePromptParams(params);
	if (method === "session/new") return `cwd=present mcpServers=${arrayLength(params.mcpServers)} tools=disabled`;
	if (method === "initialize") return `protocolVersion=${String(params.protocolVersion ?? "unknown")}`;
	if (method === "session/cancel") return "sessionId=present";
	return summarizeObjectShape(params);
}

function summarizePromptParams(params: Record<string, unknown>): string {
	const prompt = Array.isArray(params.prompt) ? params.prompt : [];
	let textChars = 0;
	for (const block of prompt) {
		if (isRecord(block) && typeof block.text === "string") textChars += block.text.length;
	}
	return `sessionId=present blocks=${prompt.length} textChars=${textChars}`;
}

function summarizeResult(method: string, result: unknown): string {
	if (method === "session/prompt" && isRecord(result)) return `stopReason=${String(result.stopReason ?? "unknown")}`;
	if (method === "session/new" && isRecord(result)) return `sessionId=present currentModel=${summarizeNestedString(result, "models", "currentModelId")}`;
	if (method === "initialize" && isRecord(result)) return `protocolVersion=${String(result.protocolVersion ?? "unknown")}`;
	if (isRecord(result)) return summarizeObjectShape(result);
	return result === undefined ? "none" : typeof result;
}

function summarizeSessionUpdate(params: unknown): string {
	if (!isRecord(params) || !isRecord(params.update)) return "none";
	const update = params.update;
	const sessionUpdate = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "unknown";
	const content = isRecord(update.content) ? update.content : undefined;
	const contentType = typeof content?.type === "string" ? content.type : undefined;
	const textLength = typeof content?.text === "string" ? content.text.length : undefined;
	return formatInlineFields({ type: sessionUpdate, contentType, textLength });
}

function summarizeObjectShape(value: Record<string, unknown>): string {
	return `keys=${Object.keys(value)
		.map((key) => (isSensitiveKey(key) ? `${key}:redacted` : key))
		.slice(0, 8)
		.join(",")}`;
}

function summarizeNestedString(value: Record<string, unknown>, parentKey: string, childKey: string): string {
	const parent = isRecord(value[parentKey]) ? value[parentKey] : undefined;
	const child = parent?.[childKey];
	return typeof child === "string" ? child : "unknown";
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function formatTranscriptFields(fields: Record<string, TranscriptFieldValue>): string {
	const formatted = formatInlineFields(fields);
	return formatted ? ` ${formatted}` : "";
}

function formatInlineFields(fields: Record<string, TranscriptFieldValue>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		parts.push(`${key}=${formatTranscriptValue(key, value)}`);
	}
	return parts.join(" ");
}

function formatTranscriptValue(key: string, value: Exclude<TranscriptFieldValue, undefined>): string {
	if (isSensitiveKey(key)) return "[redacted]";
	return String(value).replaceAll(/\s+/g, " ").slice(0, 200);
}

function isSensitiveKey(key: string): boolean {
	return /(^|_|-)(token|apiKey|secret|auth|password|credential|cookie|sessionId|bearer)($|_|-)/i.test(key);
}

function countLines(value: string): number {
	if (!value) return 0;
	return value.split("\n").length - (value.endsWith("\n") ? 1 : 0);
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

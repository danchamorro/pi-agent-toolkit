import { CodexAppServerClient } from "./codex-app-server.ts";
import type { HarnessCallbacks, HarnessTerminalResult } from "./harness.ts";
import type { CodexLaunchConfig } from "./launch-config.ts";
import { execFileText, parseVersion, resolveExecutable, withTimeout } from "./native-process.ts";

const REQUIRED_CODEX_VERSION = "0.145.0";
const TURN_TIMEOUT_MS = 60 * 60 * 1000;
const INTERRUPT_TIMEOUT_MS = 5_000;
const BACKGROUND_TERMINAL_CLEANUP_TIMEOUT_MS = 1_000;

type ModelListResult = {
  data?: Array<{
    id?: unknown;
    model?: unknown;
    supportedReasoningEfforts?: Array<{ reasoningEffort?: unknown }>;
  }>;
};

type ThreadStartResult = { thread?: { id?: unknown }; model?: unknown; reasoningEffort?: unknown };
type TurnStartResult = { turn?: { id?: unknown } };

type TerminalEvent = {
  status: HarnessTerminalResult["status"];
  error?: string;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function usageFromNotification(params: unknown): HarnessTerminalResult["contextUsage"] {
  const root = objectValue(params);
  const tokenUsage = objectValue(root?.tokenUsage);
  const last = objectValue(tokenUsage?.last);
  const tokens = last?.totalTokens;
  const contextWindow = tokenUsage?.modelContextWindow;
  if (typeof tokens !== "number") return undefined;
  if (typeof contextWindow === "number" && contextWindow > 0) {
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }
  return { tokens, contextWindow: 0, percent: null };
}

function activityFromItem(params: unknown): string | undefined {
  const root = objectValue(params);
  const item = objectValue(root?.item);
  switch (item?.type) {
    case "agentMessage":
      return typeof item.text === "string" ? item.text : undefined;
    case "reasoning": {
      const summary = item.summary;
      return Array.isArray(summary) && typeof summary.at(-1) === "string"
        ? summary.at(-1)
        : undefined;
    }
    case "commandExecution":
      return typeof item.command === "string"
        ? `Codex ran: ${item.command}`
        : "Codex ran a command.";
    case "fileChange":
      return "Codex changed files.";
    case "dynamicToolCall":
      return typeof item.tool === "string" ? `Codex used ${item.tool}.` : undefined;
    default:
      return undefined;
  }
}

export async function runCodexSubagent(
  launch: CodexLaunchConfig,
  callbacks: HarnessCallbacks,
  signal: AbortSignal,
): Promise<HarnessTerminalResult> {
  let executable: string;
  let version: string;
  try {
    executable = await resolveExecutable(launch.executable, "codex");
    const versionResult = await execFileText(executable, ["--version"], 10_000, signal);
    version = parseVersion(versionResult.stdout) ?? "";
    if (version !== REQUIRED_CODEX_VERSION) {
      throw new Error(
        `Codex CLI ${REQUIRED_CODEX_VERSION} is required for the experimental app-server protocol; found ${version || "an unknown version"} at ${executable}.`,
      );
    }
  } catch (error) {
    return {
      status: signal.aborted ? "stopped" : "failed",
      error: signal.aborted
        ? "Codex sub-agent stopped."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }

  if (signal.aborted) return { status: "stopped", error: "Codex sub-agent stopped." };

  let client: CodexAppServerClient | undefined;
  let threadId: string | undefined;
  let turnId: string | undefined;
  let result = "";
  let resolvedModel: string | undefined;
  let contextUsage: HarnessTerminalResult["contextUsage"];
  let terminalResolve: ((event: TerminalEvent) => void) | undefined;
  const terminal = new Promise<TerminalEvent>((resolve) => {
    terminalResolve = resolve;
  });
  let settled = false;
  let abortHandler: (() => void) | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const settle = (event: TerminalEvent) => {
    if (settled) return;
    settled = true;
    terminalResolve?.(event);
  };
  const cleanBackgroundTerminals = (): Promise<void> => {
    if (!client || !threadId) return Promise.resolve();
    cleanupPromise ??= client
      .request(
        "thread/backgroundTerminals/clean",
        { threadId },
        BACKGROUND_TERMINAL_CLEANUP_TIMEOUT_MS,
      )
      .then(
        () => undefined,
        () => undefined,
      );
    return cleanupPromise;
  };

  try {
    client = new CodexAppServerClient(executable);
    const runningClient = client;
    abortHandler = () => {
      if (threadId && turnId) {
        void withTimeout(
          runningClient.request("turn/interrupt", { threadId, turnId }),
          INTERRUPT_TIMEOUT_MS,
          "Codex interrupt timed out.",
        ).catch(() => undefined);
      } else if (threadId) {
        void cleanBackgroundTerminals()
          .then(() => runningClient.close())
          .catch(() => undefined);
      } else if (!threadId) {
        void runningClient.close();
      }
      settle({ status: "stopped", error: "Codex sub-agent stopped." });
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();

    client.onServerRequest(async (method, params) => {
      if (method === "item/tool/call") {
        const request = objectValue(params);
        const args = objectValue(request?.arguments);
        if (request?.tool !== "ask_main_session" || typeof args?.question !== "string") {
          throw new Error(`Unsupported Codex dynamic tool request: ${String(request?.tool)}`);
        }
        const answer = await callbacks.askMainSession(
          args.question,
          typeof args.context === "string" ? args.context : undefined,
        );
        return { contentItems: [{ type: "inputText", text: answer }], success: true };
      }
      if (method === "item/tool/requestUserInput") {
        const request = objectValue(params);
        const questions = Array.isArray(request?.questions) ? request.questions : [];
        const prompt = questions
          .map((question) => objectValue(question)?.question)
          .filter((question): question is string => typeof question === "string")
          .join("\n");
        const answer = await callbacks.askMainSession(prompt || "Codex requested input.");
        return {
          answers: Object.fromEntries(
            questions
              .map((question) => objectValue(question)?.id)
              .filter((id): id is string => typeof id === "string")
              .map((id) => [id, { answers: [answer] }]),
          ),
        };
      }
      if (
        method === "item/commandExecution/requestApproval" ||
        method === "item/fileChange/requestApproval"
      ) {
        return { decision: "decline" };
      }
      if (method === "mcpServer/elicitation/request") {
        return { action: "decline", content: null, _meta: null };
      }
      throw new Error(`Declined unexpected Codex server request: ${method}`);
    });
    client.onNotification((method, params) => {
      const root = objectValue(params);
      if (method === "item/agentMessage/delta" && typeof root?.delta === "string") {
        result += root.delta;
      } else if (method === "item/completed") {
        const item = objectValue(root?.item);
        if (item?.type === "agentMessage" && typeof item.text === "string") result = item.text;
        const activity = activityFromItem(params);
        if (activity) callbacks.activity(activity, contextUsage);
      } else if (method === "thread/tokenUsage/updated") {
        contextUsage = usageFromNotification(params) ?? contextUsage;
      } else if (method === "model/rerouted") {
        settle({
          status: "failed",
          error: `Codex rerouted from ${String(root?.fromModel)} to ${String(root?.toModel)}; fallback is disabled.`,
        });
      } else if (method === "error" && root?.willRetry !== true) {
        const error = objectValue(root?.error);
        settle({
          status: "failed",
          error:
            typeof error?.message === "string"
              ? error.message
              : "Codex app-server reported an error.",
        });
      } else if (method === "turn/completed") {
        const turn = objectValue(root?.turn);
        const status = turn?.status;
        const error = objectValue(turn?.error);
        settle({
          status:
            status === "completed"
              ? "completed"
              : status === "interrupted"
                ? signal.aborted
                  ? "stopped"
                  : "interrupted"
                : "failed",
          error: typeof error?.message === "string" ? error.message : undefined,
        });
      } else if (method === "process/exit" || method === "client/error") {
        const error = objectValue(params)?.error;
        settle({ status: signal.aborted ? "stopped" : "interrupted", error: String(error) });
      }
    });

    await client.initialize();
    const accountResponse = objectValue(
      await client.request("account/read", { refreshToken: false }),
    );
    const account = objectValue(accountResponse?.account);
    const authStatus = objectValue(
      await client.request("getAuthStatus", {
        includeToken: false,
        refreshToken: false,
      }),
    );
    if (!account && authStatus?.authMethod == null) {
      throw new Error("Codex CLI is not authenticated. Run `codex login` first.");
    }
    if (
      account?.type !== "chatgpt" ||
      accountResponse?.requiresOpenaiAuth !== true ||
      authStatus?.authMethod !== "chatgpt" ||
      authStatus.requiresOpenaiAuth !== true
    ) {
      throw new Error(
        `Codex native sub-agents require ChatGPT authentication; found account type ${String(account?.type)} and auth mode ${String(authStatus?.authMethod)}.`,
      );
    }
    const models = (await client.request("model/list", {
      limit: 100,
      includeHidden: true,
    })) as ModelListResult;
    const model = models.data?.find(
      (entry) => entry.id === launch.model || entry.model === launch.model,
    );
    if (!model) {
      const available = models.data
        ?.map((entry) => entry.id)
        .filter((id): id is string => typeof id === "string")
        .join(", ");
      throw new Error(
        `Codex model "${launch.model}" is unavailable. Available models: ${available || "none"}.`,
      );
    }
    const efforts =
      model.supportedReasoningEfforts
        ?.map((entry) => entry.reasoningEffort)
        .filter((effort): effort is string => typeof effort === "string") ?? [];
    if (!efforts.includes(launch.resolvedEffort)) {
      throw new Error(
        `Codex model "${launch.model}" does not support reasoning effort "${launch.resolvedEffort}". Supported values: ${efforts.join(", ") || "none"}.`,
      );
    }

    if (signal.aborted) throw new Error("Codex sub-agent stopped before task dispatch.");
    callbacks.activity(`Codex ${version} ready at ${executable} with ${launch.model}.`);
    const thread = (await client.request("thread/start", {
      model: launch.model,
      allowProviderModelFallback: false,
      cwd: launch.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      developerInstructions: launch.neutralInstructions,
      ephemeral: true,
      dynamicTools: [
        {
          type: "function",
          name: "ask_main_session",
          description: "Ask the main session one blocking question and wait for its reply.",
          inputSchema: {
            type: "object",
            properties: {
              question: { type: "string" },
              context: { type: "string" },
            },
            required: ["question"],
            additionalProperties: false,
          },
        },
      ],
    })) as ThreadStartResult;
    if (typeof thread.thread?.id !== "string")
      throw new Error("Codex thread/start returned no thread id.");
    threadId = thread.thread.id;
    resolvedModel = typeof thread.model === "string" ? thread.model : launch.model;
    if (resolvedModel !== launch.model) {
      throw new Error(
        `Codex selected ${resolvedModel} instead of ${launch.model}; fallback is disabled.`,
      );
    }
    if (signal.aborted) throw new Error("Codex sub-agent stopped before task dispatch.");
    const turn = (await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: launch.task }],
      cwd: launch.cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      model: launch.model,
      effort: launch.resolvedEffort,
    })) as TurnStartResult;
    if (typeof turn.turn?.id !== "string") throw new Error("Codex turn/start returned no turn id.");
    turnId = turn.turn.id;
    callbacks.activity(`Codex turn ${turnId} started.`);

    const terminalEvent = await withTimeout(
      terminal,
      TURN_TIMEOUT_MS,
      "Codex turn exceeded the maximum runtime.",
    );
    return {
      status: terminalEvent.status,
      result: terminalEvent.status === "completed" ? result || "(No text response)" : undefined,
      error: terminalEvent.error,
      contextUsage,
      resolvedModel,
      nativeSessionId: threadId,
      nativeRuntimeVersion: version,
      nativeExecutable: executable,
    };
  } catch (error) {
    return {
      status: signal.aborted ? "stopped" : "failed",
      error: `${error instanceof Error ? error.message : String(error)}${client?.stderr ? `\n${client.stderr}` : ""}`,
      contextUsage,
      resolvedModel,
      nativeSessionId: threadId,
      nativeRuntimeVersion: version,
      nativeExecutable: executable,
    };
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    await cleanBackgroundTerminals();
    await client?.close();
  }
}

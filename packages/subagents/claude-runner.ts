import { z } from "zod/v4";

import type { EffortLevel, Query } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudeLaunchConfig } from "./launch-config.ts";
import type { HarnessCallbacks, HarnessTerminalResult } from "./harness.ts";
import {
  execFileText,
  parseVersion,
  resolveExecutable,
  versionAtLeast,
  withTimeout,
} from "./native-process.ts";

const MINIMUM_CLAUDE_CODE_VERSION = "2.1.219";
const STARTUP_TIMEOUT_MS = 20_000;
const INTERRUPT_TIMEOUT_MS = 5_000;
const CONTEXT_USAGE_TIMEOUT_MS = 5_000;
const STDERR_TAIL_LENGTH = 4_000;

/**
 * Endpoint, credential, and provider-routing variables that can move a Claude
 * Code session off the first-party subscription backend. The harness is
 * subscription-only with no fallback, so a set value is a launch failure rather
 * than something to tolerate, and the value is also stripped from every child
 * environment so neither preflight nor the SDK subprocess can inherit it.
 */
const BLOCKED_ENVIRONMENT_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "ANTHROPIC_UNIX_SOCKET",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_AWS_BASE_URL",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
  "ANTHROPIC_GOOGLE_CLOUD_PROJECT",
  "ANTHROPIC_GOOGLE_CLOUD_LOCATION",
  "CLOUD_ML_REGION",
] as const;

function blockedEnvironmentOverrides(environment: NodeJS.ProcessEnv): string[] {
  return BLOCKED_ENVIRONMENT_VARIABLES.filter((name) => (environment[name] ?? "").trim() !== "");
}

function subscriptionOnlyEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe = { ...environment };
  for (const name of BLOCKED_ENVIRONMENT_VARIABLES) delete safe[name];
  return safe;
}

/**
 * Current context-window usage from the CLI, not a cumulative token total, so
 * compaction shows as a decrease and the percentage can never exceed 100.
 * Telemetry failures resolve to `undefined` so callers keep their last
 * successful snapshot.
 */
async function currentContextUsage(
  query: Pick<Query, "getContextUsage">,
): Promise<HarnessTerminalResult["contextUsage"]> {
  try {
    const usage = await withTimeout(
      query.getContextUsage(),
      CONTEXT_USAGE_TIMEOUT_MS,
      "Claude context usage request timed out.",
    );
    const tokens = usage?.totalTokens;
    const contextWindow = usage?.maxTokens;
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return undefined;
    if (
      typeof contextWindow !== "number" ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0
    ) {
      return undefined;
    }
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  } catch {
    return undefined;
  }
}

function assistantActivity(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const block = content.at(-1);
  if (!block || typeof block !== "object") return undefined;
  const typed = block as { type?: unknown; text?: unknown; name?: unknown };
  if (typed.type === "tool_use" && typeof typed.name === "string")
    return `Claude used ${typed.name}.`;
  if ((typed.type === "text" || typed.type === "thinking") && typeof typed.text === "string") {
    return typed.text;
  }
  return undefined;
}

export type ClaudeRunnerDependencies = {
  resolveExecutable: typeof resolveExecutable;
  execFileText: typeof execFileText;
  loadSdk(): Promise<typeof import("@anthropic-ai/claude-agent-sdk")>;
};

const defaultDependencies: ClaudeRunnerDependencies = {
  resolveExecutable,
  execFileText,
  loadSdk: () => import("@anthropic-ai/claude-agent-sdk"),
};

export async function runClaudeSubagent(
  launch: ClaudeLaunchConfig,
  callbacks: HarnessCallbacks,
  signal: AbortSignal,
  dependencies: ClaudeRunnerDependencies = defaultDependencies,
): Promise<HarnessTerminalResult> {
  if (signal.aborted) return { status: "stopped", error: "Claude sub-agent stopped." };
  const blockedOverrides = blockedEnvironmentOverrides(process.env);
  if (blockedOverrides.length > 0) {
    return {
      status: "failed",
      error: `${blockedOverrides.join(", ")} ${blockedOverrides.length === 1 ? "is" : "are"} set and may reroute Claude away from subscription authentication. Unset ${blockedOverrides.length === 1 ? "it" : "them"} before launching the subscription-backed Claude harness.`,
    };
  }
  const safeEnvironment = subscriptionOnlyEnvironment(process.env);

  let executable: string;
  let version: string;
  try {
    executable = await dependencies.resolveExecutable(launch.executable, "claude");
    const versionResult = await dependencies.execFileText(
      executable,
      ["--version"],
      10_000,
      signal,
      safeEnvironment,
    );
    version = parseVersion(versionResult.stdout) ?? "";
    if (!version || !versionAtLeast(version, MINIMUM_CLAUDE_CODE_VERSION)) {
      throw new Error(
        `Claude Code ${MINIMUM_CLAUDE_CODE_VERSION} or newer is required; found ${version || "an unknown version"}.`,
      );
    }
    const authResult = await dependencies.execFileText(
      executable,
      ["auth", "status", "--json"],
      10_000,
      signal,
      safeEnvironment,
    );
    const auth = JSON.parse(authResult.stdout) as {
      loggedIn?: unknown;
      authMethod?: unknown;
      apiProvider?: unknown;
      subscriptionType?: unknown;
    };
    if (
      auth.loggedIn !== true ||
      auth.authMethod !== "claude.ai" ||
      auth.apiProvider !== "firstParty" ||
      typeof auth.subscriptionType !== "string"
    ) {
      throw new Error(
        "Claude Code is not authenticated with a Claude subscription on the first-party API. Run `claude auth login` first.",
      );
    }
  } catch (error) {
    return {
      status: signal.aborted ? "stopped" : "failed",
      error: signal.aborted
        ? "Claude sub-agent stopped."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }

  if (signal.aborted) return { status: "stopped", error: "Claude sub-agent stopped." };

  let sdk: typeof import("@anthropic-ai/claude-agent-sdk");
  try {
    sdk = await dependencies.loadSdk();
  } catch (error) {
    return {
      status: signal.aborted ? "stopped" : "failed",
      error: signal.aborted
        ? "Claude sub-agent stopped."
        : `Claude Agent SDK is unavailable. Install @anthropic-ai/claude-agent-sdk@0.3.220. ${error instanceof Error ? error.message : String(error)}`,
      nativeRuntimeVersion: version,
      nativeExecutable: executable,
    };
  }

  const abortController = new AbortController();
  let dispatch: (() => void) | undefined;
  const dispatchReady = new Promise<void>((resolve) => {
    dispatch = resolve;
  });
  async function* input() {
    await dispatchReady;
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: launch.task },
      parent_tool_use_id: null,
      session_id: "",
    };
  }

  const feedbackTool = sdk.tool(
    "ask_main_session",
    "Ask the main session one blocking question and wait for its reply.",
    { question: z.string(), context: z.string().optional() },
    async ({ question, context }) => ({
      content: [{ type: "text" as const, text: await callbacks.askMainSession(question, context) }],
    }),
    { alwaysLoad: true },
  );
  const feedbackServer = sdk.createSdkMcpServer({
    name: "pi_subagents",
    version: "1.0.0",
    tools: [feedbackTool],
    alwaysLoad: true,
  });
  let stderrTail = "";
  const query = sdk.query({
    prompt: input(),
    options: {
      abortController,
      cwd: launch.cwd,
      env: safeEnvironment,
      model: launch.model,
      effort: launch.resolvedEffort as EffortLevel,
      thinking: { type: "adaptive" },
      systemPrompt: { type: "preset", preset: "claude_code", append: launch.neutralInstructions },
      tools: { type: "preset", preset: "claude_code" },
      disallowedTools: ["Agent", "Task"],
      mcpServers: { pi_subagents: feedbackServer },
      strictMcpConfig: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      pathToClaudeCodeExecutable: executable,
      stderr(data) {
        stderrTail = `${stderrTail}${data}`.slice(-STDERR_TAIL_LENGTH);
      },
    },
  });

  let nativeSessionId: string | undefined;
  let resolvedModel: string | undefined;
  let lastUsage: HarnessTerminalResult["contextUsage"];
  const abortHandler = () => {
    void withTimeout(query.interrupt(), INTERRUPT_TIMEOUT_MS, "Claude interrupt timed out.")
      .catch(() => undefined)
      .finally(() => {
        abortController.abort();
        query.close();
      });
  };
  signal.addEventListener("abort", abortHandler, { once: true });
  if (signal.aborted) abortHandler();

  try {
    const initialization = await withTimeout(
      query.initializationResult(),
      STARTUP_TIMEOUT_MS,
      "Claude Agent SDK initialization timed out.",
    );
    if (initialization.account.apiProvider !== "firstParty") {
      throw new Error(
        `Claude Code is routed to the "${initialization.account.apiProvider ?? "unknown"}" API provider; only the first-party subscription backend is allowed.`,
      );
    }
    const model = initialization.models.find(
      (entry) => entry.value === launch.model || entry.resolvedModel === launch.model,
    );
    if (!model) {
      throw new Error(`Claude model "${launch.model}" is unavailable. No fallback was attempted.`);
    }
    // The catalog exposes one row per model under an alias (`opus`) plus the
    // canonical id it resolves to (`claude-opus-5`); both name the pinned model,
    // so both are accepted identities. Anything else is a reroute.
    const pinnedModelIdentities = new Set(
      [launch.model, model.value, model.resolvedModel].filter(
        (identity): identity is string => typeof identity === "string" && identity.length > 0,
      ),
    );
    const supportedEfforts = model.supportedEffortLevels ?? [];
    if (!supportedEfforts.includes(launch.resolvedEffort as (typeof supportedEfforts)[number])) {
      throw new Error(
        `Claude model "${launch.model}" does not support reasoning effort "${launch.resolvedEffort}". Supported values: ${supportedEfforts.join(", ") || "none"}.`,
      );
    }
    if (signal.aborted) throw new Error("Claude sub-agent stopped before task dispatch.");
    callbacks.activity(`Claude Code ${version} ready with ${launch.model}.`);
    dispatch?.();

    for await (const message of query) {
      nativeSessionId = "session_id" in message ? message.session_id : nativeSessionId;
      if (message.type === "system" && message.subtype === "init") {
        resolvedModel = message.model;
        lastUsage = (await currentContextUsage(query)) ?? lastUsage;
        callbacks.activity(`Claude started with ${message.model}.`, lastUsage);
      } else if (message.type === "assistant" && message.parent_tool_use_id === null) {
        const activity = assistantActivity(message.message);
        lastUsage = (await currentContextUsage(query)) ?? lastUsage;
        if (activity) callbacks.activity(activity, lastUsage);
        if (message.error) throw new Error(`Claude failed: ${message.error}.`);
      } else if (message.type === "result") {
        lastUsage = (await currentContextUsage(query)) ?? lastUsage;
        if (message.subtype === "success" && !message.is_error) {
          const modelUsage = Object.entries(message.modelUsage).at(-1);
          const actualModel =
            modelUsage?.[1].canonicalModel ?? modelUsage?.[0] ?? resolvedModel ?? launch.model;
          if (!pinnedModelIdentities.has(actualModel)) {
            throw new Error(
              `Claude rerouted from ${launch.model} to ${actualModel}; fallback is disabled.`,
            );
          }
          const provider = modelUsage?.[1].provider;
          if (provider !== undefined && provider !== "firstParty") {
            throw new Error(
              `Claude served ${launch.model} through the "${provider}" API provider; only the first-party subscription backend is allowed.`,
            );
          }
          return {
            status: "completed",
            result: message.result,
            contextUsage: lastUsage,
            resolvedModel: actualModel,
            nativeSessionId,
            nativeRuntimeVersion: version,
            nativeExecutable: executable,
          };
        }
        const errors = "errors" in message ? message.errors.join("; ") : message.stop_reason;
        throw new Error(errors || "Claude execution failed.");
      }
    }
    throw new Error("Claude ended without a terminal result.");
  } catch (error) {
    const stopped = signal.aborted;
    return {
      status: stopped ? "stopped" : "failed",
      error: stopped
        ? "Claude sub-agent stopped."
        : `${error instanceof Error ? error.message : String(error)}${stderrTail ? `\n${stderrTail}` : ""}`,
      contextUsage: lastUsage,
      resolvedModel,
      nativeSessionId,
      nativeRuntimeVersion: version,
      nativeExecutable: executable,
    };
  } finally {
    signal.removeEventListener("abort", abortHandler);
    abortController.abort();
    query.close();
  }
}

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runClaudeSubagent, type ClaudeRunnerDependencies } from "../claude-runner.ts";
import type { ClaudeLaunchConfig } from "../launch-config.ts";
import type { ContextUsage } from "@earendil-works/pi-coding-agent";

const REROUTING_ENVIRONMENT_VARIABLES = [
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

let previousEnvironment: Record<string, string | undefined> = {};

function launch(): ClaudeLaunchConfig {
  return {
    harness: "claude",
    backend: "claude-sdk",
    recordId: "sa-1",
    parentSessionId: "parent",
    name: "claude",
    task: "Review the change.",
    cwd: "/tmp",
    autoExit: false,
    thinkingLevel: "high",
    launchToken: "token",
    model: "claude-opus-5",
    resolvedEffort: "high",
    neutralInstructions: "Stay focused.",
  };
}

type CapturedOptions = Record<string, unknown> & {
  mcpServers?: Record<string, { tools?: Array<{ handler?: (args: unknown) => Promise<unknown> }> }>;
};

type Captured = {
  options?: CapturedOptions;
  feedbackResult?: unknown;
  interrupted?: boolean;
  preflightEnvironments?: Array<NodeJS.ProcessEnv | undefined>;
};

type ContextUsageSnapshot = { totalTokens: number; maxTokens: number } | Error;

type ModelUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextWindow: number;
  canonicalModel?: string;
  provider?: string;
};

function dependencies(options: {
  availableModel?: string;
  availableModelResolved?: string;
  apiProvider?: string;
  contextUsages?: ContextUsageSnapshot[];
  modelUsage?: Record<string, ModelUsageEntry>;
  captured: Captured;
}): ClaudeRunnerDependencies {
  return {
    async resolveExecutable() {
      return "/usr/local/bin/claude";
    },
    async execFileText(_executable, args, _timeout, _signal, env) {
      options.captured.preflightEnvironments = [
        ...(options.captured.preflightEnvironments ?? []),
        env,
      ];
      return args.includes("--version")
        ? { stdout: "2.1.220 (Claude Code)\n", stderr: "" }
        : {
            stdout: JSON.stringify({
              loggedIn: true,
              authMethod: "claude.ai",
              apiProvider: "firstParty",
              subscriptionType: "pro",
            }),
            stderr: "",
          };
    },
    async loadSdk() {
      const contextUsages = [...(options.contextUsages ?? [])];
      const fakeSdk = {
        tool(
          _name: string,
          _description: string,
          _schema: unknown,
          handler: (args: unknown) => Promise<unknown>,
        ) {
          return { handler };
        },
        createSdkMcpServer(serverOptions: unknown) {
          return serverOptions;
        },
        query({
          prompt,
          options: queryOptions,
        }: {
          prompt: AsyncIterable<unknown>;
          options: CapturedOptions;
        }) {
          options.captured.options = queryOptions;
          let sequence = 0;
          let closed = false;
          const query = {
            async initializationResult() {
              return {
                models: [
                  {
                    value: options.availableModel ?? "claude-opus-5",
                    resolvedModel:
                      options.availableModelResolved ?? options.availableModel ?? "claude-opus-5",
                    displayName: "Opus 5",
                    description: "",
                    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
                  },
                ],
                account: {
                  subscriptionType: "pro",
                  apiProvider: options.apiProvider ?? "firstParty",
                },
              };
            },
            async getContextUsage() {
              const snapshot = contextUsages.shift();
              if (snapshot instanceof Error) throw snapshot;
              if (!snapshot) throw new Error("No context usage snapshot configured.");
              return snapshot;
            },
            async interrupt() {
              options.captured.interrupted = true;
            },
            close() {
              closed = true;
            },
            async next() {
              if (closed) return { done: true, value: undefined };
              sequence += 1;
              if (sequence === 1) {
                await prompt[Symbol.asyncIterator]().next();
                return {
                  done: false,
                  value: {
                    type: "system",
                    subtype: "init",
                    model: "claude-opus-5",
                    session_id: "claude-session",
                  },
                };
              }
              if (sequence === 2) {
                const server = queryOptions.mcpServers?.pi_subagents;
                const handler = server?.tools?.[0]?.handler;
                assert.ok(handler);
                options.captured.feedbackResult = await handler({
                  question: "Which path?",
                  context: "Need a decision.",
                });
                return {
                  done: false,
                  value: {
                    type: "assistant",
                    parent_tool_use_id: null,
                    session_id: "claude-session",
                    message: { content: [{ type: "text", text: "Working." }] },
                  },
                };
              }
              if (sequence === 3) {
                return {
                  done: false,
                  value: {
                    type: "result",
                    subtype: "success",
                    is_error: false,
                    result: "Review complete.",
                    stop_reason: null,
                    session_id: "claude-session",
                    modelUsage: options.modelUsage ?? {
                      "claude-opus-5": {
                        inputTokens: 100,
                        outputTokens: 20,
                        cacheReadInputTokens: 50,
                        cacheCreationInputTokens: 0,
                        contextWindow: 1000,
                      },
                    },
                  },
                };
              }
              return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
              return this;
            },
          };
          return query;
        },
      };
      return fakeSdk as unknown as Awaited<ReturnType<ClaudeRunnerDependencies["loadSdk"]>>;
    },
  };
}

function usage(totalTokens: number, maxTokens: number): ContextUsageSnapshot {
  return { totalTokens, maxTokens };
}

async function run(
  dependencyOptions: Parameters<typeof dependencies>[0],
  overrides: Partial<ClaudeLaunchConfig> = {},
  activities: Array<{ text: string; usage?: ContextUsage }> = [],
) {
  return runClaudeSubagent(
    { ...launch(), ...overrides },
    {
      activity(text, contextUsage) {
        activities.push({ text, usage: contextUsage });
      },
      async askMainSession() {
        return "Use the current path.";
      },
    },
    new AbortController().signal,
    dependencies(dependencyOptions),
  );
}

describe("runClaudeSubagent", () => {
  beforeEach(() => {
    previousEnvironment = {};
    for (const name of REROUTING_ENVIRONMENT_VARIABLES) {
      previousEnvironment[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of REROUTING_ENVIRONMENT_VARIABLES) {
      const previous = previousEnvironment[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  it("uses Opus 5, adaptive thinking, bypass permissions, and feedback", async () => {
    const captured: Captured = {};
    const questions: string[] = [];
    const result = await runClaudeSubagent(
      launch(),
      {
        activity() {},
        async askMainSession(question) {
          questions.push(question);
          return "Use the current path.";
        },
      },
      new AbortController().signal,
      dependencies({
        captured,
        contextUsages: [
          usage(10_000, 1_000_000),
          usage(20_000, 1_000_000),
          usage(30_000, 1_000_000),
        ],
      }),
    );

    assert.equal(result.status, "completed");
    assert.equal(result.result, "Review complete.");
    assert.equal(result.resolvedModel, "claude-opus-5");
    assert.deepEqual(result.contextUsage, {
      tokens: 30_000,
      contextWindow: 1_000_000,
      percent: 3,
    });
    assert.deepEqual(questions, ["Which path?"]);
    assert.equal(captured.options?.model, "claude-opus-5");
    assert.equal(captured.options?.effort, "high");
    assert.deepEqual(captured.options?.thinking, { type: "adaptive" });
    assert.equal(captured.options?.permissionMode, "bypassPermissions");
    assert.equal(captured.options?.allowDangerouslySkipPermissions, true);
    assert.deepEqual(captured.options?.disallowedTools, ["Agent", "Task"]);
    assert.deepEqual(captured.options?.systemPrompt, {
      type: "preset",
      preset: "claude_code",
      append: "Stay focused.",
    });
  });

  it("stops before task dispatch when already aborted", async () => {
    const captured: Captured = {};
    const controller = new AbortController();
    controller.abort();
    const result = await runClaudeSubagent(
      launch(),
      {
        activity() {},
        async askMainSession() {
          return "";
        },
      },
      controller.signal,
      dependencies({ captured }),
    );

    assert.equal(result.status, "stopped");
    assert.equal(captured.feedbackResult, undefined);
    assert.equal(captured.options, undefined);
  });

  it("fails before task dispatch when Opus 5 is unavailable", async () => {
    const captured: Captured = {};
    const result = await run({ availableModel: "claude-sonnet-5", captured });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /claude-opus-5.*unavailable/u);
  });

  for (const name of REROUTING_ENVIRONMENT_VARIABLES) {
    it(`refuses to launch when ${name} is set`, async () => {
      process.env[name] = name.endsWith("_URL") ? "https://example.invalid" : "1";
      const captured: Captured = {};
      const result = await run({ captured });

      assert.equal(result.status, "failed");
      assert.match(result.error ?? "", new RegExp(`^${name} is set`, "u"));
      assert.equal(captured.options, undefined);
      assert.equal(captured.preflightEnvironments, undefined);
    });
  }

  it("lists every rerouting override that is set", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://example.invalid";
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    const captured: Captured = {};
    const result = await run({ captured });

    assert.equal(result.status, "failed");
    assert.match(
      result.error ?? "",
      /^ANTHROPIC_BASE_URL, CLAUDE_CODE_USE_BEDROCK are set and may reroute Claude/u,
    );
  });

  it("strips rerouting variables from preflight and SDK environments", async () => {
    process.env.PI_SUBAGENTS_CLAUDE_ENV_PROBE = "inherited";
    const captured: Captured = {};
    try {
      const result = await run({
        captured,
        contextUsages: [usage(1, 100), usage(2, 100), usage(3, 100)],
      });

      assert.equal(result.status, "completed");
      const sdkEnvironment = captured.options?.env as NodeJS.ProcessEnv;
      const environments = [...(captured.preflightEnvironments ?? []), sdkEnvironment];
      assert.equal(environments.length, 3);
      for (const environment of environments) {
        assert.ok(environment, "expected an explicit environment");
        assert.equal(environment.PI_SUBAGENTS_CLAUDE_ENV_PROBE, "inherited");
        for (const name of REROUTING_ENVIRONMENT_VARIABLES) {
          assert.ok(!(name in environment), `${name} must not reach the Claude process`);
        }
      }
    } finally {
      delete process.env.PI_SUBAGENTS_CLAUDE_ENV_PROBE;
    }
  });

  it("fails when the SDK session is not on the first-party API provider", async () => {
    const captured: Captured = {};
    const result = await run({ apiProvider: "bedrock", captured });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /"bedrock" API provider/u);
  });

  it("fails when the served usage reports a non-first-party provider", async () => {
    const captured: Captured = {};
    const result = await run({
      captured,
      contextUsages: [usage(1, 100), usage(2, 100), usage(3, 100)],
      modelUsage: {
        "claude-opus-5": {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextWindow: 1_000_000,
          provider: "vertex",
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /"vertex" API provider/u);
  });

  it("accepts the catalog alias and its resolved canonical model as one identity", async () => {
    const captured: Captured = {};
    const result = await run(
      {
        availableModel: "opus",
        availableModelResolved: "claude-opus-5",
        captured,
        contextUsages: [usage(1, 100), usage(2, 100), usage(3, 100)],
        modelUsage: {
          opus: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextWindow: 1_000_000,
            canonicalModel: "claude-opus-5",
            provider: "firstParty",
          },
        },
      },
      { model: "opus" },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.resolvedModel, "claude-opus-5");
  });

  it("still rejects a reroute to a different model", async () => {
    const captured: Captured = {};
    const result = await run({
      captured,
      contextUsages: [usage(1, 100), usage(2, 100), usage(3, 100)],
      modelUsage: {
        "claude-sonnet-5": {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextWindow: 1_000_000,
          canonicalModel: "claude-sonnet-5",
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /rerouted from claude-opus-5 to claude-sonnet-5/u);
  });

  it("reports current context usage instead of cumulative model usage above 100 percent", async () => {
    const captured: Captured = {};
    const activities: Array<{ text: string; usage?: ContextUsage }> = [];
    const result = await run(
      {
        captured,
        contextUsages: [
          usage(100_000, 1_000_000),
          usage(150_000, 1_000_000),
          usage(200_000, 1_000_000),
        ],
        modelUsage: {
          "claude-opus-5": {
            inputTokens: 5_000_000,
            outputTokens: 200_000,
            cacheReadInputTokens: 4_000_000,
            cacheCreationInputTokens: 1_000_000,
            contextWindow: 1_000_000,
          },
        },
      },
      {},
      activities,
    );

    assert.equal(result.status, "completed");
    assert.deepEqual(result.contextUsage, {
      tokens: 200_000,
      contextWindow: 1_000_000,
      percent: 20,
    });
    assert.deepEqual(
      activities.filter((entry) => entry.usage).map((entry) => entry.usage?.percent),
      [10, 15],
    );
  });

  it("publishes a compaction decrease", async () => {
    const captured: Captured = {};
    const activities: Array<{ text: string; usage?: ContextUsage }> = [];
    const result = await run(
      {
        captured,
        contextUsages: [
          usage(900_000, 1_000_000),
          usage(120_000, 1_000_000),
          usage(130_000, 1_000_000),
        ],
      },
      {},
      activities,
    );

    assert.equal(result.status, "completed");
    assert.deepEqual(
      activities.filter((entry) => entry.usage).map((entry) => entry.usage?.percent),
      [90, 12],
    );
    assert.equal(result.contextUsage?.percent, 13);
  });

  it("keeps the latest valid snapshot when context telemetry fails", async () => {
    const captured: Captured = {};
    const activities: Array<{ text: string; usage?: ContextUsage }> = [];
    const result = await run(
      {
        captured,
        contextUsages: [
          usage(250_000, 1_000_000),
          new Error("context usage unavailable"),
          new Error("context usage unavailable"),
        ],
      },
      {},
      activities,
    );

    assert.equal(result.status, "completed");
    assert.deepEqual(result.contextUsage, {
      tokens: 250_000,
      contextWindow: 1_000_000,
      percent: 25,
    });
    assert.deepEqual(
      activities.filter((entry) => entry.usage).map((entry) => entry.usage?.percent),
      [25, 25],
    );
  });

  it("omits context usage when telemetry never succeeds", async () => {
    const captured: Captured = {};
    const result = await run({
      captured,
      contextUsages: [
        new Error("unavailable"),
        new Error("unavailable"),
        { totalTokens: 10, maxTokens: 0 },
      ],
    });

    assert.equal(result.status, "completed");
    assert.equal(result.contextUsage, undefined);
  });
});

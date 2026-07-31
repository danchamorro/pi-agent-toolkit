import assert from "node:assert/strict";
import test from "node:test";

import fastModeExtension from "../extensions/openai-fast-mode.ts";

type TestContext = {
  model: { provider: string; id: string };
  statuses: Array<string | undefined>;
  notifications: string[];
  ui: {
    setStatus(key: string, value?: string): void;
    notify(message: string): void;
  };
};
type Handler = (event: { payload: unknown }, ctx: TestContext) => unknown;
type CommandHandler = (args: string, ctx: TestContext) => Promise<void>;

function createHarness() {
  const handlers = new Map<string, Handler>();
  let commandHandler: CommandHandler | undefined;

  fastModeExtension({
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      assert.equal(name, "fast");
      commandHandler = options.handler;
    },
  } as never);

  return {
    beforeRequest: handlers.get("before_provider_request")!,
    command: (args: string, ctx: TestContext) => commandHandler!(args, ctx),
  };
}

function createContext(
  model = "gpt-5.6-sol",
  provider = "openai-codex",
): TestContext {
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  return {
    model: { provider, id: model },
    statuses,
    notifications,
    ui: {
      setStatus(_key, value) {
        statuses.push(value);
      },
      notify(message) {
        notifications.push(message);
      },
    },
  };
}

test("Fast mode is off by default and injects priority only when enabled", async () => {
  const harness = createHarness();
  const ctx = createContext();
  const event = { payload: { model: "gpt-5.6-sol" } };

  assert.equal(harness.beforeRequest(event, ctx), undefined);

  await harness.command("on", ctx);
  assert.deepEqual(harness.beforeRequest(event, ctx), {
    model: "gpt-5.6-sol",
    service_tier: "priority",
  });
  assert.equal(ctx.statuses.at(-1), "fast requested");
  assert.equal(ctx.notifications.at(-1), "Fast mode: requested");

  await harness.command("off", ctx);
  assert.equal(harness.beforeRequest(event, ctx), undefined);
});

test("Fast mode only targets supported subscription models", async () => {
  const harness = createHarness();
  const supported = [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
  ];
  await harness.command("on", createContext());

  for (const model of supported) {
    const result = harness.beforeRequest({ payload: {} }, createContext(model));
    assert.deepEqual(result, { service_tier: "priority" });
  }

  assert.equal(
    harness.beforeRequest({ payload: {} }, createContext("gpt-5.6-future")),
    undefined,
  );
  assert.equal(
    harness.beforeRequest(
      { payload: {} },
      createContext("gpt-5.6-sol", "openai"),
    ),
    undefined,
  );
});

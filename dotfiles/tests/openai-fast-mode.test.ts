import assert from "node:assert/strict";
import test from "node:test";

import fastModeExtension from "../extensions/openai-fast-mode.ts";

type TestContext = {
  model: { provider: string; id: string };
  ui: { setStatus(): void; notify(): void };
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

function createContext(model = "gpt-5.6-sol"): TestContext {
  return {
    model: { provider: "openai-codex", id: model },
    ui: { setStatus() {}, notify() {} },
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

  await harness.command("off", ctx);
  assert.equal(harness.beforeRequest(event, ctx), undefined);
});

test("Fast mode leaves unsupported models unchanged", async () => {
  const harness = createHarness();
  const ctx = createContext("gpt-5.3-codex-spark");
  await harness.command("on", ctx);

  assert.equal(harness.beforeRequest({ payload: {} }, ctx), undefined);
});

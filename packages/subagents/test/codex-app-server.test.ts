import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { CodexAppServerClient } from "../codex-app-server.ts";

let testDir = "";

function writeServer(name: string, body: string): string {
  const path = join(testDir, name);
  writeFileSync(path, `#!/usr/bin/env node\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

describe("CodexAppServerClient", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pi-codex-app-server-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("round-trips requests, notifications, and server requests", async () => {
    const executable = writeServer(
      "fake-codex",
      `
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
let triggerId;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
  } else if (message.method === "initialized") {
    process.stdout.write(JSON.stringify({ method: "test/ready", params: { ready: true } }) + "\\n");
  } else if (message.method === "trigger") {
    triggerId = message.id;
    process.stdout.write(JSON.stringify({ id: 99, method: "item/tool/call", params: { value: 42 } }) + "\\n");
  } else if (message.id === 99) {
    process.stdout.write(JSON.stringify({ id: triggerId, result: message.result }) + "\\n");
  }
});
`,
    );
    const client = new CodexAppServerClient(executable);
    const notifications: string[] = [];
    client.onNotification((method) => notifications.push(method));
    client.onServerRequest(async (method, params) => ({ method, params }));

    await client.initialize();
    const result = await client.request("trigger", {});
    assert.deepEqual(result, { method: "item/tool/call", params: { value: 42 } });
    assert.deepEqual(notifications, ["test/ready"]);
    await client.close();
  });

  it("closes safely when a notification handler throws", async () => {
    const executable = writeServer(
      "throwing-notification-codex",
      `
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  } else if (message.method === "initialized") {
    process.stdout.write(JSON.stringify({ method: "test/ready", params: {} }) + "\\n");
  }
});
`,
    );
    const client = new CodexAppServerClient(executable);
    const methods: string[] = [];
    let markNotificationHandled: (() => void) | undefined;
    const notificationHandled = new Promise<void>((resolve) => {
      markNotificationHandled = resolve;
    });
    client.onNotification((method) => {
      methods.push(method);
      markNotificationHandled?.();
      throw new Error("notification handler failed");
    });

    await client.initialize();
    await notificationHandled;
    assert.deepEqual(methods, ["test/ready", "client/error"]);
    await assert.rejects(() => client.request("after-notification-error", {}), /closed/u);
    await client.close();
  });

  it("bounds unanswered requests", async () => {
    const executable = writeServer(
      "silent-codex",
      `
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  }
});
`,
    );
    const client = new CodexAppServerClient(executable);
    await client.initialize();
    await assert.rejects(() => client.request("silent", {}, 20), /timed out/u);
    await client.close();
  });

  it("fails closed on malformed protocol frames", async () => {
    const executable = writeServer(
      "malformed-codex",
      `
process.stdin.once("data", () => process.stdout.write("not json\\n"));
setInterval(() => {}, 1000);
`,
    );
    const client = new CodexAppServerClient(executable);
    await assert.rejects(() => client.initialize(), /Malformed Codex app-server frame/u);
    await client.close();
  });

  it("rejects inbound and outbound frames over one MiB", async (context) => {
    await context.test("outbound", async () => {
      const executable = writeServer(
        "outbound-limit-codex",
        `
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  }
});
`,
      );
      const client = new CodexAppServerClient(executable);
      await client.initialize();
      await assert.rejects(
        () => client.request("oversized", { text: "x".repeat(1024 * 1024) }),
        /outbound frame exceeded the size limit/u,
      );
      await client.close();
    });

    await context.test("inbound", async () => {
      const executable = writeServer(
        "inbound-limit-codex",
        `
process.stdin.once("data", () => process.stdout.write("x".repeat(1024 * 1024 + 1) + "\\n"));
setInterval(() => {}, 1000);
`,
      );
      const client = new CodexAppServerClient(executable);
      await assert.rejects(() => client.initialize(), /frame exceeded the size limit/u);
      await client.close();
    });
  });

  it("does not write a delayed server response after close", async () => {
    const executable = writeServer(
      "delayed-codex",
      `
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
    process.stdout.write(JSON.stringify({ id: 99, method: "item/tool/call", params: {} }) + "\\n");
  }
});
`,
    );
    const client = new CodexAppServerClient(executable);
    let releaseHandler: (() => void) | undefined;
    let markHandlerStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      markHandlerStarted = resolve;
    });
    client.onServerRequest(async () => {
      markHandlerStarted?.();
      await new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      return {};
    });

    await client.initialize();
    await handlerStarted;
    const close = client.close();
    releaseHandler?.();
    await close;
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("terminates the app-server process tree on close", async () => {
    const executable = writeServer(
      "child-process-codex",
      `
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  } else if (message.method === "initialized") {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    process.stdout.write(JSON.stringify({ method: "test/child", params: { pid: child.pid } }) + "\\n");
  }
});
`,
    );
    const client = new CodexAppServerClient(executable);
    let childPid = 0;
    let markChildStarted: (() => void) | undefined;
    const childStarted = new Promise<void>((resolve) => {
      markChildStarted = resolve;
    });
    client.onNotification((method, params) => {
      if (method !== "test/child") return;
      childPid = (params as { pid: number }).pid;
      markChildStarted?.();
    });

    await client.initialize();
    await childStarted;
    assert.ok(childPid > 0);
    await client.close();

    let running = true;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        process.kill(childPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          running = false;
          break;
        }
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(running, false);
  });
});

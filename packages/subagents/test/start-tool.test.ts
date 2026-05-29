import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import subagentsExtension from "../index.ts";

type RegisteredTool = {
  name: string;
  execute: (...args: unknown[]) => unknown;
};

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details?: {
    status?: string;
    subagentId?: string;
    command?: string;
  };
};

let testDir = "";
let previousAgentDir: string | undefined;

function neverResolve(): Promise<never> {
  return new Promise(() => undefined);
}

describe("start_subagent tool", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pi-subagents-start-tool-test-"));
    mkdirSync(join(testDir, "agent"), { recursive: true });
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(testDir, "agent");
  });

  afterEach(() => {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns immediately after launching the background record", async () => {
    const tools = new Map<string, RegisteredTool>();
    let authRequested = false;
    const model = { provider: "test-provider", id: "test-model" };
    const pi = {
      registerCommand() {
        return undefined;
      },
      registerTool(tool: RegisteredTool) {
        tools.set(tool.name, tool);
      },
      on() {
        return undefined;
      },
      getActiveTools() {
        return [];
      },
      getThinkingLevel() {
        return "off";
      },
      sendMessage() {
        return undefined;
      },
    };
    const ctx = {
      cwd: testDir,
      hasUI: false,
      model,
      modelRegistry: {
        getApiKeyAndHeaders() {
          authRequested = true;
          return neverResolve();
        },
      },
    };

    subagentsExtension(pi as unknown as Parameters<typeof subagentsExtension>[0]);
    const startTool = tools.get("start_subagent");

    assert.ok(startTool);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error("start_subagent waited for the child session"));
      }, 50);
    });

    try {
      const result = (await Promise.race([
        Promise.resolve(
          startTool.execute(
            "tool-call-1",
            { task: "Map the package source." },
            undefined,
            undefined,
            ctx,
          ),
        ),
        timeoutPromise,
      ])) as ToolResult;

      assert.equal(authRequested, true);
      assert.equal(result.details?.status, "starting");
      assert.equal(result.details?.subagentId, "sa-1");
      assert.match(result.content[0]?.text ?? "", /running in the background/);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  });
});

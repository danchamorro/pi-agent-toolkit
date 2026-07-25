import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  deriveHerdrSessionName,
  HerdrCommandError,
  HerdrSessionController,
  type HerdrRunner,
} from "../herdr.ts";

describe("deriveHerdrSessionName", () => {
  it("creates stable isolated valid names", () => {
    const first = deriveHerdrSessionName("parent-one");
    assert.equal(first, deriveHerdrSessionName("parent-one"));
    assert.notEqual(first, deriveHerdrSessionName("parent-two"));
    assert.match(first, /^pi-subagents-[a-f0-9]{20}$/u);
    assert.ok(first.length <= 64);
  });
});

describe("HerdrSessionController", () => {
  it("starts an unavailable named server and waits for its API", async () => {
    const ownershipRoot = mkdtempSync(join(tmpdir(), "pi-subagents-herdr-owner-"));
    let running = false;
    let starts = 0;
    let startedSession = "";
    const run: HerdrRunner = async (args) => {
      assert.deepEqual(args, ["workspace", "list"]);
      if (!running) {
        throw new HerdrCommandError("not running");
      }
      return response({ type: "workspace_list", workspaces: [] });
    };
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run,
      async startServer(sessionName) {
        starts += 1;
        startedSession = sessionName;
        running = true;
      },
      ownershipRoot,
    });

    try {
      await Promise.all([controller.ensureServer(), controller.ensureServer()]);
      assert.equal(starts, 1);
      assert.equal(startedSession, controller.sessionName);
    } finally {
      rmSync(ownershipRoot, { recursive: true, force: true });
    }
  });

  it("recovers only an owned session whose parent process exited", async () => {
    const ownershipRoot = mkdtempSync(join(tmpdir(), "pi-subagents-herdr-owner-"));
    const sessionName = deriveHerdrSessionName("parent");
    mkdirSync(ownershipRoot, { recursive: true });
    writeFileSync(
      join(ownershipRoot, `${sessionName}.json`),
      JSON.stringify({
        version: 1,
        parentSessionId: "parent",
        sessionName,
        ownerPid: 2_147_483_647,
      }),
    );
    let running = true;
    let starts = 0;
    let deletes = 0;
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async (args) => {
        if (args.join(" ") === "server stop") {
          running = false;
          return response({ type: "ok" });
        }
        assert.deepEqual(args, ["workspace", "list"]);
        if (!running) {
          throw new HerdrCommandError("not running");
        }
        return response({ type: "workspace_list", workspaces: [] });
      },
      async startServer() {
        starts += 1;
        running = true;
      },
      async deleteSession() {
        deletes += 1;
        assert.equal(running, false);
      },
      ownershipRoot,
    });

    try {
      await controller.ensureServer();
      assert.equal(starts, 1);
      assert.equal(deletes, 1);
    } finally {
      rmSync(ownershipRoot, { recursive: true, force: true });
    }
  });

  it("refuses to adopt a pre-existing named session", async () => {
    const ownershipRoot = mkdtempSync(join(tmpdir(), "pi-subagents-herdr-owner-"));
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async () => response({ type: "workspace_list", workspaces: [] }),
      startServer: async () => assert.fail("must not start"),
      ownershipRoot,
    });

    try {
      await assert.rejects(controller.ensureServer(), /Refusing to adopt/u);
    } finally {
      rmSync(ownershipRoot, { recursive: true, force: true });
    }
  });

  it("does not treat arbitrary Herdr errors as an absent session", async () => {
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async () => {
        throw new HerdrCommandError("permission denied");
      },
      startServer: async () => assert.fail("must not start"),
    });

    await assert.rejects(controller.ensureServer(), /permission denied/u);
  });

  it("creates one workspace with multiple child tabs and survives id compaction", async () => {
    const fake = createTopologyRunner();
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: fake.run,
      startServer: async () => {},
    });
    const environment = { PI_SUBAGENT_RUN_DIR: "/private/run" };

    const first = await controller.createChild("sa-1", "scout", "/repo", environment);
    const second = await controller.createChild("sa-2", "reviewer", "/repo", environment);
    assert.equal(first.workspaceId, "w1");
    assert.equal(first.tabId, "w1:t1");
    assert.equal(second.workspaceId, "w1");
    assert.equal(second.tabId, "w1:t2");
    assert.equal(fake.commands.filter((args) => args[0] === "workspace").length, 2);
    assert.deepEqual(
      fake.commands.find((args) => args[0] === "tab" && args[1] === "create")?.slice(-2),
      ["--env", "PI_SUBAGENT_RUN_DIR=/private/run"],
    );

    await controller.closeChild("sa-1");
    await controller.startAgent(second, ["--model", "xai/grok-4.5", "@/private/task"], {
      onAttempt() {},
    });
    const start = fake.commands.find((args) => args[0] === "agent");
    assert.deepEqual(start?.slice(0, 8), [
      "agent",
      "start",
      "sa-2",
      "--kind",
      "pi",
      "--pane",
      "w1:p1",
      "--timeout",
    ]);
    assert.ok(start?.includes("@/private/task"));

    await controller.closeChild("sa-2");
    assert.ok(fake.commands.some((args) => args.join(" ") === "workspace close w1"));
  });

  it("cancels child creation before dispatch", async () => {
    const abort = new AbortController();
    let runStarted = false;
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async (_args, options) => {
        runStarted = true;
        return await new Promise<string>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      },
      startServer: async () => {},
    });

    const creating = controller.createChild("sa-1", "worker", "/repo", {}, abort.signal);
    while (!runStarted) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    abort.abort(new Error("stop requested"));

    await assert.rejects(creating, /stop requested/u);
  });

  it("releases child ownership when topology cleanup fails", async () => {
    const fake = createTopologyRunner();
    let failWorkspaceList = false;
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async (args, options) => {
        if (failWorkspaceList && args.join(" ") === "workspace list") {
          failWorkspaceList = false;
          throw new HerdrCommandError("temporary failure");
        }
        return await fake.run(args, options);
      },
      startServer: async () => {},
    });
    await controller.createChild("sa-1", "worker", "/repo", {});
    failWorkspaceList = true;

    await assert.rejects(controller.closeChild("sa-1"), /temporary failure/u);
    const commandCount = fake.commands.length;
    await controller.closeChild("sa-1");
    assert.equal(fake.commands.length, commandCount);
  });

  it("retries shell-busy agent starts without changing argv", async () => {
    const fake = createTopologyRunner();
    fake.busyStarts = 1;
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: fake.run,
      startServer: async () => {},
    });
    const child = await controller.createChild("sa-1", "worker", "/repo", {});
    let attempts = 0;

    await controller.startAgent(child, ["--no-extensions"], {
      onAttempt() {
        attempts += 1;
      },
    });

    assert.equal(fake.commands.filter((args) => args[0] === "agent").length, 2);
    assert.equal(attempts, 1);
  });

  it("attempts session deletion and aggregates teardown failures", async () => {
    let deleteAttempted = false;
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async () => {
        throw new Error("stop failed");
      },
      startServer: async () => {},
      deleteSession: async () => {
        deleteAttempted = true;
        throw new Error("delete failed");
      },
    });

    await assert.rejects(controller.stopAndDelete(), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      return true;
    });
    assert.equal(deleteAttempted, true);
  });

  it("rejects unowned child control", async () => {
    const controller = new HerdrSessionController({
      parentSessionId: "parent",
      run: async () => assert.fail("must not call Herdr"),
      startServer: async () => {},
    });

    await assert.rejects(controller.childExists("sa-99"), /unowned/u);
  });
});

function response(result: Record<string, unknown>): string {
  return JSON.stringify({ id: "test", result });
}

function createTopologyRunner(): {
  run: HerdrRunner;
  commands: string[][];
  busyStarts: number;
} {
  const state = {
    commands: [] as string[][],
    busyStarts: 0,
    workspace: undefined as { id: string; label: string } | undefined,
    tabs: [] as Array<{ id: string; label: string; paneId: string }>,
  };
  const api = {
    get busyStarts() {
      return state.busyStarts;
    },
    set busyStarts(value: number) {
      state.busyStarts = value;
    },
    commands: state.commands,
    run: (async (args: string[]) => {
      state.commands.push(args);
      const key = args.slice(0, 2).join(" ");
      if (key === "workspace create") {
        const label = args[args.indexOf("--label") + 1] ?? "workspace";
        state.workspace = { id: "w1", label };
        state.tabs = [{ id: "w1:t1", label: "1", paneId: "w1:p1" }];
        return response({
          type: "workspace_created",
          workspace: { workspace_id: "w1", label },
          tab: { tab_id: "w1:t1", workspace_id: "w1", label: "1" },
          root_pane: { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1" },
        });
      }
      if (key === "workspace list") {
        return response({
          type: "workspace_list",
          workspaces: state.workspace
            ? [{ workspace_id: state.workspace.id, label: state.workspace.label }]
            : [],
        });
      }
      if (key === "workspace close") {
        state.workspace = undefined;
        state.tabs = [];
        return response({ type: "workspace_closed" });
      }
      if (key === "tab rename") {
        const tab = state.tabs.find((candidate) => candidate.id === args[2]);
        assert.ok(tab);
        tab.label = args[3] ?? tab.label;
        return response({ type: "tab_info", tab: {} });
      }
      if (key === "tab create") {
        const number = state.tabs.length + 1;
        const tab = {
          id: `w1:t${number}`,
          label: args[args.indexOf("--label") + 1] ?? String(number),
          paneId: `w1:p${number}`,
        };
        state.tabs.push(tab);
        return response({
          type: "tab_created",
          tab: { tab_id: tab.id, workspace_id: "w1", label: tab.label },
          root_pane: { pane_id: tab.paneId, workspace_id: "w1", tab_id: tab.id },
        });
      }
      if (key === "tab list") {
        return response({
          type: "tab_list",
          tabs: state.tabs.map((tab) => ({
            tab_id: tab.id,
            workspace_id: "w1",
            label: tab.label,
          })),
        });
      }
      if (key === "tab close") {
        state.tabs = state.tabs.filter((tab) => tab.id !== args[2]);
        state.tabs.forEach((tab, index) => {
          tab.id = `w1:t${index + 1}`;
          tab.paneId = `w1:p${index + 1}`;
        });
        return response({ type: "tab_closed" });
      }
      if (key === "pane list") {
        return response({
          type: "pane_list",
          panes: state.tabs.map((tab) => ({
            pane_id: tab.paneId,
            workspace_id: "w1",
            tab_id: tab.id,
          })),
        });
      }
      if (key === "agent start") {
        if (state.busyStarts > 0) {
          state.busyStarts -= 1;
          throw new HerdrCommandError("busy", { code: "agent_pane_busy" });
        }
        return response({ type: "agent_started", agent: {} });
      }
      throw new Error(`Unexpected Herdr command: ${args.join(" ")}`);
    }) as HerdrRunner,
  };
  return api;
}

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CmuxHerdrHostController,
  detectCmuxEnvironment,
  type CmuxEnvironment,
  type CmuxRunner,
} from "../cmux.ts";

const environment: CmuxEnvironment = {
  workspaceId: "workspace-uuid",
  surfaceId: "surface-uuid",
  socketPath: "/tmp/cmux.sock",
};

describe("detectCmuxEnvironment", () => {
  it("requires all caller identifiers", () => {
    assert.equal(detectCmuxEnvironment({}), undefined);
    assert.deepEqual(
      detectCmuxEnvironment({
        CMUX_WORKSPACE_ID: "workspace-uuid",
        CMUX_SURFACE_ID: "surface-uuid",
        CMUX_SOCKET_PATH: "/tmp/cmux.sock",
      }),
      environment,
    );
  });
});

describe("CmuxHerdrHostController", () => {
  it("creates and launches exactly one non-focused Herdr host", async () => {
    const fake = createRunner();
    const controller = new CmuxHerdrHostController(environment, fake.run);

    const [first, second] = await Promise.all([
      controller.launchHost("pi-subagents-session"),
      controller.launchHost("pi-subagents-session"),
    ]);

    assert.equal(first.surfaceRef, "surface:3");
    assert.deepEqual(second, first);
    assert.equal(fake.commands.filter((args) => args[0] === "new-split").length, 1);
    assert.equal(
      fake.commands.filter(
        (args) =>
          args[0] === "send" && args.at(-1) === "herdr session attach pi-subagents-session\n",
      ).length,
      1,
    );
    assert.ok(
      fake.commands.some(
        (args) =>
          args.join(" ") ===
          "new-split right --workspace workspace:1 --surface surface:1 --focus false",
      ),
    );

    controller.closeHost();
    assert.equal(controller.surfaceExists(), false);
    assert.ok(
      fake.commands.some(
        (args) => args.join(" ") === "close-surface --workspace workspace:1 --surface surface:3",
      ),
    );
  });

  it("launches Herdr again after the host surface is replaced", async () => {
    const fake = createRunner();
    const controller = new CmuxHerdrHostController(environment, fake.run);

    await controller.launchHost("pi-subagents-session");
    fake.replaceHost();
    const replacement = await controller.launchHost("pi-subagents-session");

    assert.equal(replacement.surfaceRef, "surface:5");
    assert.equal(fake.commands.filter((args) => args[0] === "new-split").length, 2);
    assert.equal(
      fake.commands.filter(
        (args) =>
          args[0] === "send" && args.at(-1) === "herdr session attach pi-subagents-session\n",
      ).length,
      2,
    );
  });

  it("closes a partially created host when validation fails", () => {
    const commands: string[][] = [];
    const run: CmuxRunner = (args) => {
      commands.push(args);
      if (args[0] === "new-split") {
        return "OK surface:3 pane:2 workspace:1\n";
      }
      if (args[0] === "identify" && args.includes("surface-uuid")) {
        return identify("workspace:1", "surface:1", "pane:1", "window:1");
      }
      if (args[0] === "identify") {
        return identify("workspace:9", "surface:3", "pane:2", "window:9");
      }
      if (args[0] === "close-surface") {
        return "OK\n";
      }
      throw new Error(`Unexpected command ${args.join(" ")}`);
    };
    const controller = new CmuxHerdrHostController(environment, run);

    assert.throws(() => controller.ensureHost(), /outside the caller workspace/u);
    assert.ok(commands.some((args) => args[0] === "close-surface"));
  });
});

function createRunner(): { run: CmuxRunner; commands: string[][]; replaceHost: () => void } {
  const commands: string[][] = [];
  let open = true;
  let activeSurface = "surface:3";
  let nextSurface = 3;
  const run: CmuxRunner = (args) => {
    commands.push(args);
    if (args[0] === "new-split") {
      open = true;
      activeSurface = `surface:${nextSurface}`;
      nextSurface += 2;
      return `OK ${activeSurface} pane:2 workspace:1\n`;
    }
    if (args[0] === "identify" && args.includes("surface-uuid")) {
      return identify("workspace:1", "surface:1", "pane:1", "window:1");
    }
    if (args[0] === "identify" && args.some((arg) => arg.startsWith("surface:"))) {
      if (!open) {
        throw new Error("not found");
      }
      return identify("workspace:1", activeSurface, "pane:2", "window:1");
    }
    if (args[0] === "rename-tab") {
      return "OK\n";
    }
    if (args[0] === "send") {
      const text = args.at(-1) ?? "";
      const marker = /^: > '([^']+)'\n$/u.exec(text)?.[1];
      if (marker) {
        writeFileSync(marker, "");
      }
      return "OK\n";
    }
    if (args[0] === "close-surface") {
      open = false;
      return "OK\n";
    }
    if (args[0] === "read-screen") {
      return "shell output";
    }
    throw new Error(`Unexpected command ${args.join(" ")}`);
  };
  return {
    run,
    commands,
    replaceHost() {
      activeSurface = "surface:4";
    },
  };
}

function identify(workspace: string, surface: string, pane: string, window: string): string {
  return JSON.stringify({
    caller: {
      workspace_ref: workspace,
      surface_ref: surface,
      pane_ref: pane,
      window_ref: window,
    },
  });
}

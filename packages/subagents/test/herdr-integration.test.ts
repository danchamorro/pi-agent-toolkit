import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import {
  createHerdrRunner,
  HerdrCommandError,
  HerdrSessionController,
  type HerdrRunner,
} from "../herdr.ts";
import { runHerdrSubagent } from "../herdr-runner.ts";
import {
  COORDINATION_VERSION,
  writeCoordinationJson,
  type CoordinationPaths,
} from "../coordination.ts";
import { writeHerdrStopControl } from "../herdr-controls.ts";
import type { SubagentLaunchConfig } from "../launch-config.ts";

const realHerdrIt =
  process.env.PI_SUBAGENTS_REAL_HERDR === "1" && process.env.PI_SUBAGENTS_REAL_MODEL ? it : it.skip;

let testDir = "";
let controllers: HerdrSessionController[] = [];

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-subagents-herdr-integration-"));
  controllers = [];
});

afterEach(async () => {
  await Promise.allSettled(controllers.map((controller) => controller.stopAndDelete()));
  rmSync(testDir, { recursive: true, force: true });
});

describe("real Herdr lifecycle", () => {
  realHerdrIt(
    "launches a real isolated child Pi and extracts its result",
    { timeout: 180_000 },
    async () => {
      const { controller, launch } = createRuntime("sa-1", "real child", true);
      launch.task = "Reply with exactly HERDR_CHILD_OK and no other text.";

      const result = await runHerdrSubagent({ launch, controller, agentDir: testDir });

      assert.equal(result.kind, "terminal", JSON.stringify(result));
      assert.equal(result.kind === "terminal" ? result.status : undefined, "completed");
      assert.match(result.kind === "terminal" ? (result.result ?? "") : "", /HERDR_CHILD_OK/u);
      assert.equal(
        typeof (result.kind === "terminal" ? result.contextUsage?.tokens : undefined),
        "number",
      );
    },
  );

  realHerdrIt(
    "runs two real child Pi sessions in parallel tabs in one Herdr workspace",
    { timeout: 180_000 },
    async () => {
      const { controller, launch: first } = createRuntime("sa-1", "parallel one", true);
      const second = createLaunch(first.parentSessionId, "sa-2", "parallel two", true);
      first.task = "Reply with exactly HERDR_PARALLEL_ONE and no other text.";
      second.task = "Reply with exactly HERDR_PARALLEL_TWO and no other text.";

      const [firstResult, secondResult] = await Promise.all([
        runHerdrSubagent({ launch: first, controller, agentDir: testDir }),
        runHerdrSubagent({ launch: second, controller, agentDir: testDir }),
      ]);

      assert.equal(firstResult.kind, "terminal", JSON.stringify(firstResult));
      assert.equal(secondResult.kind, "terminal", JSON.stringify(secondResult));
      assert.equal(
        firstResult.kind === "terminal" ? firstResult.status : undefined,
        "completed",
        JSON.stringify(firstResult),
      );
      assert.equal(
        secondResult.kind === "terminal" ? secondResult.status : undefined,
        "completed",
        JSON.stringify(secondResult),
      );
      assert.match(
        firstResult.kind === "terminal" ? (firstResult.result ?? "") : "",
        /HERDR_PARALLEL_ONE/u,
      );
      assert.match(
        secondResult.kind === "terminal" ? (secondResult.result ?? "") : "",
        /HERDR_PARALLEL_TWO/u,
      );
    },
  );

  realHerdrIt(
    "round-trips feedback and accepts direct follow-up input",
    { timeout: 240_000 },
    async () => {
      const { controller, launch } = createRuntime("sa-1", "interactive child", false);
      launch.task =
        "Call ask_main_session with the exact question 'Need code?'. After the reply, respond with exactly FEEDBACK_ followed by the feedback value. Then wait for direct input.";
      let feedbackRequests = 0;
      const firstRun = runHerdrSubagent({
        launch,
        controller,
        agentDir: testDir,
        onFeedbackRequest(request, createdPaths) {
          feedbackRequests += 1;
          writeCoordinationJson(createdPaths.feedbackResponse(request.requestId), {
            version: COORDINATION_VERSION,
            recordId: launch.recordId,
            launchToken: launch.launchToken,
            sequence: 0,
            requestId: request.requestId,
            response: "42",
            respondedAt: Date.now(),
          });
        },
      });
      const cli = createHerdrRunner(controller.sessionName);
      await waitForAgentOutput(cli, launch.recordId, "FEEDBACK_42", 120_000);
      await cli([
        "agent",
        "prompt",
        launch.recordId,
        "Call subagent_done with result exactly DIRECT_HERDR_OK and do nothing else.",
      ]);

      const result = await firstRun;

      assert.equal(feedbackRequests, 1);
      assert.equal(result.kind === "terminal" ? result.status : undefined, "completed");
      assert.match(result.kind === "terminal" ? (result.result ?? "") : "", /DIRECT_HERDR_OK/u);
    },
  );

  realHerdrIt(
    "reports a manually closed Herdr workspace as interrupted",
    { timeout: 180_000 },
    async () => {
      const { controller, launch } = createRuntime("sa-1", "closed child", false);
      launch.task = "Use bash to run sleep 120 before replying.";
      let paths: CoordinationPaths | undefined;
      let workspaceId = "";
      const run = runHerdrSubagent({
        launch,
        controller,
        agentDir: testDir,
        onPrepared(createdPaths, child) {
          paths = createdPaths;
          workspaceId = child.workspaceId;
        },
      });
      await waitFor(() => Boolean(paths && existsSync(paths.activity)), 60_000);
      await createHerdrRunner(controller.sessionName)(["workspace", "close", workspaceId]);

      const result = await run;

      assert.equal(result.kind === "terminal" ? result.status : undefined, "interrupted");
    },
  );

  realHerdrIt(
    "honors a parent stop sidecar and removes its tab",
    { timeout: 180_000 },
    async () => {
      const { controller, launch } = createRuntime("sa-1", "stopped child", false);
      launch.task = "Use bash to run sleep 120 before replying.";
      let paths: CoordinationPaths | undefined;
      const run = runHerdrSubagent({
        launch,
        controller,
        agentDir: testDir,
        onPrepared(createdPaths) {
          paths = createdPaths;
        },
      });
      await waitFor(() => Boolean(paths && existsSync(paths.activity)), 60_000);
      assert.ok(paths);
      writeHerdrStopControl(
        {
          recordId: launch.recordId,
          launchToken: launch.launchToken,
          runDirectory: paths.runDirectory,
          sequence: 0,
        },
        "Integration test stop.",
      );

      const result = await run;

      assert.equal(
        result.kind === "terminal" ? result.status : undefined,
        "stopped",
        JSON.stringify(result),
      );
    },
  );
});

function createRuntime(
  recordId: string,
  name: string,
  autoExit: boolean,
): { controller: HerdrSessionController; launch: SubagentLaunchConfig } {
  const parentSessionId = `integration-${randomUUID()}`;
  const controller = new HerdrSessionController({ parentSessionId });
  controllers.push(controller);
  return { controller, launch: createLaunch(parentSessionId, recordId, name, autoExit) };
}

function createLaunch(
  parentSessionId: string,
  recordId: string,
  name: string,
  autoExit: boolean,
): SubagentLaunchConfig {
  const modelName = process.env.PI_SUBAGENTS_REAL_MODEL;
  assert.ok(modelName);
  const slash = modelName.indexOf("/");
  assert.ok(slash > 0);
  return {
    recordId,
    parentSessionId,
    name,
    task: "",
    cwd: testDir,
    model: {
      provider: modelName.slice(0, slash),
      id: modelName.slice(slash + 1),
    } as Model<Api>,
    thinkingLevel: "off",
    tools: ["read", "bash", "ask_main_session"],
    systemPrompt: "You are an isolated integration-test child. Follow the task exactly.",
    autoExit,
    openInHerdr: true,
    launchToken: randomUUID(),
  };
}

async function waitForAgentOutput(
  run: HerdrRunner,
  target: string,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const output = await run([
        "agent",
        "read",
        target,
        "--source",
        "recent-unwrapped",
        "--lines",
        "100",
      ]);
      if (output.includes(text)) {
        return;
      }
    } catch (error) {
      if (
        !(
          error instanceof HerdrCommandError &&
          (error.code === "agent_not_found" || /No such file or directory/iu.test(error.message))
        )
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for agent output: ${text}`);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for integration state.");
}

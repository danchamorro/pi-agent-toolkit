import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const COMMAND_TIMEOUT_MS = 10_000;
const SERVER_READY_TIMEOUT_MS = 15_000;
const AGENT_START_TIMEOUT_MS = 60_000;
const AGENT_START_COMMAND_TIMEOUT_MS = 70_000;
const AGENT_BUSY_RETRY_MS = 500;
const IDLE_POLL_MS = 100;
const WORKSPACE_ID_PATTERN = /^w\d+$/u;
const TAB_ID_PATTERN = /^w\d+:t\d+$/u;
const PANE_ID_PATTERN = /^w\d+:p\d+$/u;

export type HerdrCommandOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type HerdrRunner = (args: string[], options?: HerdrCommandOptions) => Promise<string>;
export type HerdrServerStarter = (sessionName: string) => Promise<void>;
export type HerdrSessionDeleter = (sessionName: string) => Promise<void>;

export type HerdrChild = {
  recordId: string;
  workspaceLabel: string;
  tabLabel: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
};

type HerdrWorkspace = {
  workspace_id?: unknown;
  label?: unknown;
  tab_count?: unknown;
};

type HerdrTab = {
  tab_id?: unknown;
  workspace_id?: unknown;
  label?: unknown;
};

type HerdrPane = {
  pane_id?: unknown;
  workspace_id?: unknown;
  tab_id?: unknown;
};

type HerdrResponse = {
  error?: { code?: unknown; message?: unknown };
  result?: Record<string, unknown>;
};

export class HerdrCommandError extends Error {
  readonly code: string | undefined;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, options: { code?: string; stdout?: string; stderr?: string } = {}) {
    super(message);
    this.name = "HerdrCommandError";
    this.code = options.code;
    this.stdout = options.stdout ?? "";
    this.stderr = options.stderr ?? "";
  }
}

export function deriveHerdrSessionName(parentSessionId: string): string {
  const digest = createHash("sha256").update(parentSessionId).digest("hex").slice(0, 20);
  return `pi-subagents-${digest}`;
}

export function createHerdrRunner(sessionName: string): HerdrRunner {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        "herdr",
        ["--session", sessionName, ...args],
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
          signal: options.signal,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          const parsed = parseHerdrError(stdout, stderr);
          reject(
            new HerdrCommandError(
              (parsed?.message ?? stderr.trim()) || stdout.trim() || error.message,
              {
                code: parsed?.code,
                stdout,
                stderr,
              },
            ),
          );
        },
      );
    });
}

export function startHerdrServer(sessionName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("herdr", ["--session", sessionName, "server"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export class HerdrSessionController {
  readonly sessionName: string;
  private readonly run: HerdrRunner;
  private readonly startServer: HerdrServerStarter;
  private readonly deleteSession: HerdrSessionDeleter;
  private readonly ownershipFile: string;
  private readonly parentSessionId: string;
  private readonly workspacesByCwd = new Map<string, string>();
  private readonly children = new Map<string, Pick<HerdrChild, "workspaceLabel" | "tabLabel">>();
  private ready: Promise<void> | undefined;
  private topologyQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    parentSessionId: string;
    run?: HerdrRunner;
    startServer?: HerdrServerStarter;
    deleteSession?: HerdrSessionDeleter;
    ownershipRoot?: string;
  }) {
    this.parentSessionId = options.parentSessionId;
    this.sessionName = deriveHerdrSessionName(options.parentSessionId);
    this.run = options.run ?? createHerdrRunner(this.sessionName);
    this.startServer = options.startServer ?? startHerdrServer;
    this.deleteSession =
      options.deleteSession ??
      (async (sessionName) => {
        await runHerdrWithoutSession(["session", "delete", sessionName], 20_000);
      });
    this.ownershipFile = join(
      options.ownershipRoot ?? join(getAgentDir(), "state", "subagents", "herdr"),
      `${this.sessionName}.json`,
    );
  }

  ensureServer(signal?: AbortSignal): Promise<void> {
    this.ready ??= this.startAndWaitForServer(signal).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async createChild(
    recordId: string,
    name: string,
    cwd: string,
    environment: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<HerdrChild> {
    return await this.withTopology(async () => {
      signal?.throwIfAborted();
      if (this.children.has(recordId)) {
        throw new Error(`Herdr child ${recordId} already exists.`);
      }
      const workspaceLabel = this.workspacesByCwd.get(cwd) ?? workspaceLabelFor(cwd);
      const tabLabel = `${recordId}: ${name}`;
      const envArgs = environmentArgs(environment);
      let workspaceId: string;
      let tabId: string;
      let paneId: string;

      if (!this.workspacesByCwd.has(cwd)) {
        const response = parseResponse(
          await this.run(
            [
              "workspace",
              "create",
              "--cwd",
              cwd,
              "--label",
              workspaceLabel,
              "--no-focus",
              ...envArgs,
            ],
            { signal },
          ),
          "workspace create",
        );
        workspaceId = requireId(
          objectField(response, "workspace", "workspace create").workspace_id,
          WORKSPACE_ID_PATTERN,
          "workspace",
        );
        const tab = objectField(response, "tab", "workspace create");
        tabId = requireId(tab.tab_id, TAB_ID_PATTERN, "tab");
        const pane = objectField(response, "root_pane", "workspace create");
        paneId = requireId(pane.pane_id, PANE_ID_PATTERN, "pane");
        await this.run(["tab", "rename", tabId, tabLabel], { signal });
        this.workspacesByCwd.set(cwd, workspaceLabel);
      } else {
        workspaceId = await this.resolveWorkspaceId(workspaceLabel, signal);
        const response = parseResponse(
          await this.run(
            [
              "tab",
              "create",
              "--workspace",
              workspaceId,
              "--cwd",
              cwd,
              "--label",
              tabLabel,
              "--no-focus",
              ...envArgs,
            ],
            { signal },
          ),
          "tab create",
        );
        const tab = objectField(response, "tab", "tab create");
        tabId = requireId(tab.tab_id, TAB_ID_PATTERN, "tab");
        const pane = objectField(response, "root_pane", "tab create");
        paneId = requireId(pane.pane_id, PANE_ID_PATTERN, "pane");
      }

      this.children.set(recordId, { workspaceLabel, tabLabel });
      return { recordId, workspaceLabel, tabLabel, workspaceId, tabId, paneId };
    });
  }

  async startAgent(
    child: HerdrChild,
    piArguments: string[],
    options: { signal?: AbortSignal; onAttempt?: () => void } = {},
  ): Promise<void> {
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    let attempted = false;
    while (true) {
      const current = await this.resolveChild(child.recordId);
      if (!attempted) {
        attempted = true;
        options.onAttempt?.();
      }
      try {
        await this.run(
          [
            "agent",
            "start",
            child.recordId,
            "--kind",
            "pi",
            "--pane",
            current.paneId,
            "--timeout",
            String(AGENT_START_TIMEOUT_MS),
            "--",
            ...piArguments,
          ],
          { timeoutMs: AGENT_START_COMMAND_TIMEOUT_MS, signal: options.signal },
        );
        return;
      } catch (error) {
        if (
          error instanceof HerdrCommandError &&
          error.code === "agent_pane_busy" &&
          Date.now() < deadline &&
          !options.signal?.aborted
        ) {
          await wait(AGENT_BUSY_RETRY_MS, options.signal);
          continue;
        }
        throw error;
      }
    }
  }

  async childExists(recordId: string): Promise<boolean> {
    if (!this.children.has(recordId)) {
      throw new Error(`Refusing to control unowned Herdr child ${recordId}.`);
    }
    try {
      parseResponse(await this.run(["agent", "get", recordId]), "agent get");
      return true;
    } catch (error) {
      if (error instanceof HerdrCommandError && error.code?.includes("not_found")) {
        return false;
      }
      throw error;
    }
  }

  async closeChild(recordId: string): Promise<void> {
    await this.withTopology(async () => {
      const ownership = this.children.get(recordId);
      if (!ownership) {
        return;
      }
      this.children.delete(recordId);
      const workspaceId = await this.resolveWorkspaceId(ownership.workspaceLabel);
      const tabs = await this.listTabs(workspaceId);
      const tab = tabs.find((candidate) => candidate.label === ownership.tabLabel);
      if (!tab) {
        return;
      }
      const otherOwnedTabs = [...this.children.values()].filter(
        (candidate) => candidate.workspaceLabel === ownership.workspaceLabel,
      );
      if (otherOwnedTabs.length === 0) {
        await this.run(["workspace", "close", workspaceId]);
        for (const [cwd, label] of this.workspacesByCwd) {
          if (label === ownership.workspaceLabel) {
            this.workspacesByCwd.delete(cwd);
          }
        }
      } else {
        const tabId = requireId(tab.tab_id, TAB_ID_PATTERN, "tab");
        await this.run(["tab", "close", tabId]);
      }
    });
  }

  async stopAndDelete(): Promise<void> {
    this.children.clear();
    this.workspacesByCwd.clear();
    const errors: unknown[] = [];
    try {
      await this.run(["server", "stop"], { timeoutMs: 20_000 });
    } catch (error) {
      if (
        !(
          error instanceof HerdrCommandError &&
          /not running|cannot be reached|no such file or directory/iu.test(error.message)
        )
      ) {
        errors.push(error);
      }
    } finally {
      this.ready = undefined;
    }
    try {
      await this.deleteSession(this.sessionName);
      rmSync(this.ownershipFile, { force: true });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Could not stop and delete Herdr session ${this.sessionName}.`,
      );
    }
  }

  attachCommand(): string {
    return `herdr session attach ${this.sessionName}`;
  }

  private async startAndWaitForServer(signal?: AbortSignal): Promise<void> {
    try {
      await this.run(["workspace", "list"], { signal });
      if (!this.canRecoverOwnedSession()) {
        throw new Error(`Refusing to adopt an existing Herdr session ${this.sessionName}.`);
      }
      await this.stopAndDelete();
    } catch (error) {
      if (
        !(
          error instanceof HerdrCommandError &&
          /not running|cannot be reached|no such file or directory/iu.test(error.message)
        )
      ) {
        throw error;
      }
    }
    signal?.throwIfAborted();
    this.writeOwnershipMarker();
    try {
      await this.startServer(this.sessionName);
    } catch (error) {
      rmSync(this.ownershipFile, { force: true });
      throw error;
    }
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("Herdr startup aborted.");
      }
      try {
        parseResponse(await this.run(["workspace", "list"], { signal }), "workspace list");
        return;
      } catch (error) {
        if (!(error instanceof HerdrCommandError)) {
          throw error;
        }
      }
      await wait(IDLE_POLL_MS, signal);
    }
    throw new Error(`Herdr session ${this.sessionName} did not become ready.`);
  }

  private canRecoverOwnedSession(): boolean {
    try {
      const marker = JSON.parse(readFileSync(this.ownershipFile, "utf8")) as Record<
        string,
        unknown
      >;
      if (
        marker.version !== 1 ||
        marker.parentSessionId !== this.parentSessionId ||
        marker.sessionName !== this.sessionName ||
        typeof marker.ownerPid !== "number" ||
        !Number.isSafeInteger(marker.ownerPid) ||
        marker.ownerPid <= 0
      ) {
        return false;
      }
      return marker.ownerPid === process.pid || !isProcessAlive(marker.ownerPid);
    } catch {
      return false;
    }
  }

  private writeOwnershipMarker(): void {
    mkdirSync(dirname(this.ownershipFile), { recursive: true, mode: 0o700 });
    const temporaryFile = `${this.ownershipFile}.${randomUUID()}.tmp`;
    try {
      writeFileSync(
        temporaryFile,
        `${JSON.stringify({
          version: 1,
          parentSessionId: this.parentSessionId,
          sessionName: this.sessionName,
          ownerPid: process.pid,
          createdAt: Date.now(),
        })}\n`,
        { mode: 0o600 },
      );
      renameSync(temporaryFile, this.ownershipFile);
    } finally {
      rmSync(temporaryFile, { force: true });
    }
  }

  private async resolveChild(recordId: string): Promise<HerdrChild> {
    const ownership = this.children.get(recordId);
    if (!ownership) {
      throw new Error(`Refusing to control unowned Herdr child ${recordId}.`);
    }
    const workspaceId = await this.resolveWorkspaceId(ownership.workspaceLabel);
    const tab = (await this.listTabs(workspaceId)).find(
      (candidate) => candidate.label === ownership.tabLabel,
    );
    if (!tab) {
      throw new Error(`Owned Herdr child ${recordId} no longer exists.`);
    }
    const tabId = requireId(tab.tab_id, TAB_ID_PATTERN, "tab");
    const panes = await this.listPanes(workspaceId);
    const pane = panes.find((candidate) => candidate.tab_id === tabId);
    if (!pane) {
      throw new Error(`Owned Herdr child ${recordId} no longer exists.`);
    }
    return {
      recordId,
      ...ownership,
      workspaceId,
      tabId,
      paneId: requireId(pane.pane_id, PANE_ID_PATTERN, "pane"),
    };
  }

  private async resolveWorkspaceId(label: string, signal?: AbortSignal): Promise<string> {
    const response = parseResponse(
      await this.run(["workspace", "list"], { signal }),
      "workspace list",
    );
    const workspaces = arrayField(response, "workspaces", "workspace list") as HerdrWorkspace[];
    const workspace = workspaces.find((candidate) => candidate.label === label);
    if (!workspace) {
      throw new Error(`Owned Herdr workspace ${label} no longer exists.`);
    }
    return requireId(workspace.workspace_id, WORKSPACE_ID_PATTERN, "workspace");
  }

  private async listTabs(workspaceId: string): Promise<HerdrTab[]> {
    const response = parseResponse(
      await this.run(["tab", "list", "--workspace", workspaceId]),
      "tab list",
    );
    return arrayField(response, "tabs", "tab list") as HerdrTab[];
  }

  private async listPanes(workspaceId: string): Promise<HerdrPane[]> {
    const response = parseResponse(
      await this.run(["pane", "list", "--workspace", workspaceId]),
      "pane list",
    );
    return arrayField(response, "panes", "pane list") as HerdrPane[];
  }

  private async withTopology<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.topologyQueue;
    let release: () => void = () => {};
    this.topologyQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function workspaceLabelFor(cwd: string): string {
  const digest = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `Subagents ${basename(cwd) || "workspace"} ${digest}`;
}

function environmentArgs(environment: Record<string, string>): string[] {
  return Object.entries(environment).flatMap(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`Invalid child environment variable ${name}.`);
    }
    return ["--env", `${name}=${value}`];
  });
}

function parseResponse(output: string, command: string): Record<string, unknown> {
  let parsed: HerdrResponse;
  try {
    parsed = JSON.parse(output) as HerdrResponse;
  } catch {
    throw new Error(`Herdr ${command} returned invalid JSON.`);
  }
  if (parsed.error) {
    throw new HerdrCommandError(
      typeof parsed.error.message === "string" ? parsed.error.message : `Herdr ${command} failed.`,
      {
        code: typeof parsed.error.code === "string" ? parsed.error.code : undefined,
        stdout: output,
      },
    );
  }
  if (!parsed.result || typeof parsed.result !== "object") {
    throw new Error(`Herdr ${command} omitted its result.`);
  }
  return parsed.result;
}

function objectField(
  value: Record<string, unknown>,
  field: string,
  command: string,
): Record<string, unknown> {
  const result = value[field];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`Herdr ${command} omitted ${field}.`);
  }
  return result as Record<string, unknown>;
}

function arrayField(value: Record<string, unknown>, field: string, command: string): unknown[] {
  const result = value[field];
  if (!Array.isArray(result)) {
    throw new Error(`Herdr ${command} omitted ${field}.`);
  }
  return result;
}

function requireId(value: unknown, pattern: RegExp, kind: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Herdr returned an invalid ${kind} id.`);
  }
  return value;
}

function parseHerdrError(
  stdout: string,
  stderr: string,
): { code?: string; message?: string } | undefined {
  for (const candidate of [stdout.trim(), stderr.trim()]) {
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as HerdrResponse;
      if (parsed.error) {
        return {
          code: typeof parsed.error.code === "string" ? parsed.error.code : undefined,
          message: typeof parsed.error.message === "string" ? parsed.error.message : undefined,
        };
      }
    } catch {
      // Preserve the original subprocess error when Herdr did not emit JSON.
    }
  }
  return undefined;
}

function runHerdrWithoutSession(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "herdr",
      args,
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new HerdrCommandError(stderr.trim() || stdout.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Operation aborted."));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error("Operation aborted."));
      },
      { once: true },
    );
  });
}

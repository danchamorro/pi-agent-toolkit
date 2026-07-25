import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CmuxEnvironment = {
  workspaceId: string;
  surfaceId: string;
  socketPath: string;
};

export type CmuxAnchor = {
  workspaceRef: string;
  surfaceRef: string;
  paneRef: string;
  windowRef: string;
};

export type CmuxHerdrHost = {
  workspaceRef: string;
  paneRef: string;
  surfaceRef: string;
};

export type CmuxRunner = (args: string[]) => string;

type IdentifyOutput = {
  caller?: {
    workspace_ref?: unknown;
    surface_ref?: unknown;
    pane_ref?: unknown;
    window_ref?: unknown;
  };
};

const CMUX_COMMAND_TIMEOUT_MS = 10_000;
const HOST_READY_TIMEOUT_MS = 15_000;
const HOST_READY_RETRY_MS = 500;
const REF_PATTERN = /^(?:workspace|surface|pane|window):\d+$/u;
const CREATED_SURFACE_PATTERN = /^OK surface:\d+(?: pane:\d+)? workspace:\d+\s*$/u;

export function detectCmuxEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): CmuxEnvironment | undefined {
  const workspaceId = env.CMUX_WORKSPACE_ID;
  const surfaceId = env.CMUX_SURFACE_ID;
  const socketPath = env.CMUX_SOCKET_PATH;
  if (!workspaceId || !surfaceId || !socketPath) {
    return undefined;
  }
  return { workspaceId, surfaceId, socketPath };
}

export function createCmuxRunner(environment: CmuxEnvironment): CmuxRunner {
  return (args) =>
    execFileSync("cmux", args, {
      encoding: "utf8",
      env: { ...process.env, CMUX_SOCKET_PATH: environment.socketPath },
      timeout: CMUX_COMMAND_TIMEOUT_MS,
    });
}

export class CmuxHerdrHostController {
  private anchor: CmuxAnchor | undefined;
  private host: CmuxHerdrHost | undefined;
  private hostLaunched = false;
  private hostLaunch: Promise<CmuxHerdrHost> | undefined;
  private readonly environment: CmuxEnvironment;
  private readonly run: CmuxRunner;

  constructor(environment: CmuxEnvironment, run: CmuxRunner = createCmuxRunner(environment)) {
    this.environment = environment;
    this.run = run;
  }

  ensureHost(): CmuxHerdrHost {
    if (this.host && this.surfaceExists()) {
      return this.host;
    }
    const anchor = this.getAnchor();
    const surfaceRef = parseCreatedSurface(
      this.run([
        "new-split",
        "right",
        "--workspace",
        anchor.workspaceRef,
        "--surface",
        anchor.surfaceRef,
        "--focus",
        "false",
      ]),
    );
    try {
      const host = this.identify(anchor.workspaceRef, surfaceRef);
      this.validateWorkspace(anchor, host);
      this.run([
        "rename-tab",
        "--workspace",
        anchor.workspaceRef,
        "--surface",
        surfaceRef,
        "--",
        "Subagents (Herdr)",
      ]);
      this.host = {
        workspaceRef: anchor.workspaceRef,
        paneRef: host.paneRef,
        surfaceRef,
      };
      return this.host;
    } catch (error) {
      try {
        this.run(["close-surface", "--workspace", anchor.workspaceRef, "--surface", surfaceRef]);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "cmux Herdr host creation failed.", {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  async launchHost(sessionName: string): Promise<CmuxHerdrHost> {
    this.hostLaunch ??= this.launchHostOnce(sessionName).finally(() => {
      this.hostLaunch = undefined;
    });
    return await this.hostLaunch;
  }

  private async launchHostOnce(sessionName: string): Promise<CmuxHerdrHost> {
    const host = this.ensureHost();
    if (this.hostLaunched) {
      return host;
    }
    const directory = mkdtempSync(join(tmpdir(), "pi-subagents-herdr-host-"));
    const ready = join(directory, "ready");
    const deadline = Date.now() + HOST_READY_TIMEOUT_MS;
    try {
      while (!existsSync(ready) && Date.now() < deadline) {
        this.sendLine(`: > ${shellQuote(ready)}`);
        await wait(HOST_READY_RETRY_MS);
      }
      if (!existsSync(ready)) {
        throw new Error(
          `cmux Herdr host shell did not become ready.\n\n${this.readScreen(40).slice(-2_000)}`,
        );
      }
      this.sendLine(`herdr session attach ${sessionName}`);
      this.hostLaunched = true;
      return host;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  sendLine(text: string): void {
    const host = this.requireHost();
    this.run([
      "send",
      "--workspace",
      host.workspaceRef,
      "--surface",
      host.surfaceRef,
      "--",
      `${text}\\n`,
    ]);
  }

  readScreen(lines = 80): string {
    const host = this.requireHost();
    return this.run([
      "read-screen",
      "--workspace",
      host.workspaceRef,
      "--surface",
      host.surfaceRef,
      "--scrollback",
      "--lines",
      String(lines),
    ]);
  }

  surfaceExists(): boolean {
    if (!this.host) {
      return false;
    }
    try {
      const current = this.identify(this.host.workspaceRef, this.host.surfaceRef);
      return current.surfaceRef === this.host.surfaceRef;
    } catch {
      this.host = undefined;
      this.hostLaunched = false;
      return false;
    }
  }

  closeHost(): void {
    if (!this.host) {
      return;
    }
    const host = this.host;
    this.host = undefined;
    this.hostLaunched = false;
    this.hostLaunch = undefined;
    this.run(["close-surface", "--workspace", host.workspaceRef, "--surface", host.surfaceRef]);
  }

  private requireHost(): CmuxHerdrHost {
    if (!this.host) {
      throw new Error("Herdr host surface has not been created.");
    }
    return this.host;
  }

  private getAnchor(): CmuxAnchor {
    this.anchor ??= this.identify(this.environment.workspaceId, this.environment.surfaceId);
    return this.anchor;
  }

  private identify(workspace: string, surface: string): CmuxAnchor {
    const parsed = parseJson<IdentifyOutput>(
      this.run(["identify", "--workspace", workspace, "--surface", surface, "--json"]),
      "cmux identify",
    );
    const caller = parsed.caller;
    if (!caller) {
      throw new Error("cmux identify did not return caller context.");
    }
    return {
      workspaceRef: requireRef(caller.workspace_ref, "workspace"),
      surfaceRef: requireRef(caller.surface_ref, "surface"),
      paneRef: requireRef(caller.pane_ref, "pane"),
      windowRef: requireRef(caller.window_ref, "window"),
    };
  }

  private validateWorkspace(expected: CmuxAnchor, actual: CmuxAnchor): void {
    if (actual.workspaceRef !== expected.workspaceRef || actual.windowRef !== expected.windowRef) {
      throw new Error(`cmux created ${actual.surfaceRef} outside the caller workspace.`);
    }
  }
}

function parseCreatedSurface(output: string): string {
  if (!CREATED_SURFACE_PATTERN.test(output)) {
    throw new Error(`Unexpected cmux creation output: ${JSON.stringify(output.trim())}.`);
  }
  const match = /surface:\d+/u.exec(output);
  if (!match) {
    throw new Error("cmux creation output omitted a surface ref.");
  }
  return match[0];
}

function parseJson<T>(output: string, command: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`${command} returned invalid JSON.`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireRef(value: unknown, kind: "workspace" | "surface" | "pane" | "window"): string {
  if (typeof value !== "string" || !REF_PATTERN.test(value) || !value.startsWith(`${kind}:`)) {
    throw new Error(`cmux identify returned an invalid ${kind} ref.`);
  }
  return value;
}

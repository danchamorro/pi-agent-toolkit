import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { withTimeout } from "./native-process.ts";

const MAX_FRAME_BYTES = 1024 * 1024;
const STDERR_TAIL_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

type JsonObject = Record<string, unknown>;
type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export type CodexServerRequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type CodexNotificationHandler = (method: string, params: unknown) => void;

export class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrTail = "";
  private settled = false;
  private serverRequestHandler?: CodexServerRequestHandler;
  private notificationHandler?: CodexNotificationHandler;
  readonly executable: string;

  constructor(executable: string) {
    this.executable = executable;
    this.child = spawn(executable, ["app-server", "--stdio"], {
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.consumeStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-STDERR_TAIL_BYTES);
    });
    this.child.stdin.on("error", (error) => this.handleTransportError(error));
    this.child.on("error", (error) => {
      this.handleTransportError(error);
    });
    this.child.on("exit", (code, signal) => {
      if (!this.settled) {
        const error = new Error(
          `Codex app-server exited unexpectedly (${signal ?? code ?? "unknown"}).${this.stderrTail ? ` ${this.stderrTail}` : ""}`,
        );
        this.fail(error);
        this.dispatchNotification("process/exit", { error });
      }
    });
  }

  get stderr(): string {
    return this.stderrTail;
  }

  onServerRequest(handler: CodexServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  onNotification(handler: CodexNotificationHandler): void {
    this.notificationHandler = handler;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "pi-subagents", title: "Pi Subagents", version: "1.0.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.write({ method: "initialized" });
  }

  request(method: string, params: unknown, timeout = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.settled) return Promise.reject(new Error("Codex app-server is closed."));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request ${method} timed out.`));
      }, timeout);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        if (!this.write({ method, id, params })) {
          throw new Error("Codex app-server is closed.");
        }
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async close(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    this.rejectPending(new Error("Codex app-server closed."));
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.terminate("SIGTERM");
    try {
      await withTimeout(
        new Promise<void>((resolve) => this.child.once("exit", () => resolve())),
        SHUTDOWN_TIMEOUT_MS,
        "Codex app-server shutdown timed out.",
      );
    } catch {
      this.terminate("SIGKILL");
    }
  }

  private write(message: JsonObject): boolean {
    const frame = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
      throw new Error("Codex app-server outbound frame exceeded the size limit.");
    }
    if (this.settled || this.child.stdin.destroyed || this.child.stdin.writableEnded) return false;
    this.child.stdin.write(frame);
    return true;
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.length > MAX_FRAME_BYTES && !this.stdoutBuffer.includes(10)) {
      const error = new Error("Codex app-server frame exceeded the size limit.");
      this.handleTransportError(error);
      return;
    }
    let newline = this.stdoutBuffer.indexOf(10);
    while (newline >= 0) {
      const frame = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (frame.length > MAX_FRAME_BYTES) {
        const error = new Error("Codex app-server frame exceeded the size limit.");
        this.handleTransportError(error);
        return;
      }
      if (frame.length > 0) this.handleFrame(frame.toString("utf8"));
      newline = this.stdoutBuffer.indexOf(10);
    }
  }

  private handleFrame(frame: string): void {
    let message: JsonObject;
    try {
      const parsed = JSON.parse(frame) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("frame is not an object");
      }
      message = parsed as JsonObject;
    } catch (error) {
      const failure = new Error(
        `Malformed Codex app-server frame: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.handleTransportError(failure);
      return;
    }

    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = message.error as { message?: unknown };
        pending.reject(
          new Error(typeof error.message === "string" ? error.message : "Codex request failed."),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.id === "number" && typeof message.method === "string") {
      void this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    if (typeof message.method === "string") {
      this.dispatchNotification(message.method, message.params);
    }
  }

  private async handleServerRequest(id: number, method: string, params: unknown): Promise<void> {
    try {
      if (!this.serverRequestHandler) throw new Error(`Unsupported server request: ${method}`);
      const result = await this.serverRequestHandler(method, params);
      this.write({ id, result });
    } catch (error) {
      if (this.settled) return;
      try {
        this.write({
          id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        });
      } catch (writeError) {
        this.handleTransportError(
          writeError instanceof Error ? writeError : new Error(String(writeError)),
        );
      }
    }
  }

  private handleTransportError(error: Error): void {
    if (this.settled) return;
    this.fail(error);
    void this.close().catch(() => undefined);
    this.dispatchNotification("client/error", { error });
  }

  private dispatchNotification(method: string, params: unknown): void {
    try {
      this.notificationHandler?.(method, params);
    } catch (error) {
      if (method === "client/error") return;
      this.handleTransportError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private terminate(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(this.child.pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
      });
      return;
    }
    try {
      process.kill(-this.child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

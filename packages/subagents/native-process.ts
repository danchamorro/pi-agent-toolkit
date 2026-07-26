import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export async function resolveExecutable(
  executable: string | undefined,
  fallbackName: string,
): Promise<string> {
  if (executable) {
    if (!isAbsolute(executable)) {
      throw new Error(`Configured executable must be absolute: ${executable}`);
    }
    await access(executable, constants.X_OK);
    return executable;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, fallbackName);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES") throw error;
    }
  }
  throw new Error(`${fallbackName} executable was not found on PATH.`);
}

export function execFileText(
  executable: string,
  args: string[],
  timeout = 10_000,
  signal?: AbortSignal,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout, maxBuffer: 1024 * 1024, signal, env },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || stdout.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export function parseVersion(text: string): string | undefined {
  return /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u.exec(text)?.[1];
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] !== minimumParts[index]) {
      return actualParts[index] > minimumParts[index];
    }
  }
  return true;
}

export function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

export function expandUserPath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function formatPathForDisplay(path: string): string {
  const home = homedir();
  if (path === home) {
    return "~";
  }
  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }
  return path;
}

export function resolveSubagentCwd(
  requestedCwd: string | undefined,
  baseCwd: string,
): { cwd?: string; error?: string } {
  const raw = requestedCwd?.trim();
  if (!raw) {
    return { cwd: baseCwd };
  }

  const cwd = resolvePath(baseCwd, expandUserPath(raw));
  if (!existsSync(cwd)) {
    return { error: `Sub-agent cwd does not exist: ${cwd}` };
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not inspect sub-agent cwd ${cwd}: ${message}` };
  }
  if (!stats.isDirectory()) {
    return { error: `Sub-agent cwd is not a directory: ${cwd}` };
  }

  return { cwd };
}

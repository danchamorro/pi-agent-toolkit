import { execSync } from "node:child_process";
import pc from "picocolors";

const PACKAGE_NAME = "pi-agent-toolkit";

/** Fetch the latest version from the npm registry */
function fetchLatestVersion(): string | null {
  try {
    const result = execSync(`npm view ${PACKAGE_NAME} version`, {
      stdio: "pipe",
      timeout: 15_000,
    });
    return result.toString().trim();
  } catch {
    return null;
  }
}

/** Compare two semver strings. Returns -1, 0, or 1. */
function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Run the global npm update */
function runGlobalUpdate(): boolean {
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      stdio: "inherit",
      timeout: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function runUpdate(currentVersion: string): void {
  console.log();
  console.log(pc.bold("pi-agent-toolkit update"));
  console.log();
  console.log(`${pc.dim("Current version:")} ${currentVersion}`);

  const latest = fetchLatestVersion();

  if (!latest) {
    console.log(pc.red("Could not reach the npm registry. Check your network connection."));
    console.log();
    return;
  }

  console.log(`${pc.dim("Latest version:")}  ${latest}`);
  console.log();

  const cmp = compareSemver(currentVersion, latest);

  if (cmp >= 0) {
    console.log(pc.green("Already up to date."));
    console.log();
    return;
  }

  console.log(pc.cyan(`Updating ${currentVersion} -> ${latest}...`));
  console.log();

  const success = runGlobalUpdate();

  if (success) {
    console.log();
    console.log(pc.green(`Updated to ${latest}.`));
    console.log(pc.dim('Run "pi-agent-toolkit install" to pick up any new or updated components.'));
  } else {
    console.log();
    console.log(pc.red("Update failed. Try manually:"));
    console.log(pc.dim(`  npm install -g ${PACKAGE_NAME}@latest`));
  }
  console.log();
}

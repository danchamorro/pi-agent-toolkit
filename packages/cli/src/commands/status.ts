import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { resolve, basename } from "node:path";
import pc from "picocolors";
import { readManifest } from "../lib/manifest.ts";
import { registry, type Component } from "../lib/registry.ts";
import {
  PI_AGENT_DIR,
  PI_EXTENSIONS_DIR,
  PI_SKILLS_DIR,
  PI_PROMPTS_DIR,
  PI_AGENTS_DIR,
  PI_THEMES_DIR,
  AGENTS_SKILLS_DIR,
} from "../lib/paths.ts";

type FileStatus = "ok" | "missing" | "not-installed" | "untracked";

interface StatusEntry {
  name: string;
  category: string;
  status: FileStatus;
  detail?: string;
}

/** Resolve where we expect a component to exist on disk */
function expectedPath(component: Component): string | null {
  switch (component.category) {
    case "extensions": {
      const name = component.isDirectory
        ? component.name
        : basename(component.source ?? component.name);
      return resolve(PI_EXTENSIONS_DIR, name);
    }
    case "skills-bundled": {
      if (component.target === "global-skills") {
        return resolve(AGENTS_SKILLS_DIR, component.name);
      }
      return resolve(PI_SKILLS_DIR, component.name);
    }
    case "skills-external": {
      const piPath = resolve(PI_SKILLS_DIR, component.name);
      const agentsPath = resolve(AGENTS_SKILLS_DIR, component.name);
      // Check both locations, prefer whichever exists
      if (existsSync(piPath)) return piPath;
      return agentsPath;
    }
    case "prompts":
      return resolve(PI_PROMPTS_DIR, component.name);
    case "agents":
      return resolve(PI_AGENTS_DIR, component.name);
    case "themes": {
      const themeName = (component.source ?? component.name).endsWith(".json")
        ? basename(component.source ?? component.name)
        : component.name + ".json";
      return resolve(PI_THEMES_DIR, themeName);
    }
    case "packages":
      return null; // Can't easily check pi packages on disk
    case "configs": {
      const name = (component.source ?? component.name).replace(".template", "");
      return resolve(PI_AGENT_DIR, name);
    }
    default:
      return null;
  }
}

function checkFile(path: string): { exists: boolean; detail?: string } {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      const target = readlinkSync(path);
      const dangling = !existsSync(path);
      return {
        exists: !dangling,
        detail: dangling ? `dangling symlink -> ${target}` : `symlink -> ${target}`,
      };
    }
    return { exists: true };
  } catch {
    return { exists: false };
  }
}

export function runStatus(): void {
  const manifest = readManifest();

  console.log();
  console.log(pc.bold("pi-agent-toolkit status"));
  console.log();

  if (!manifest.installedAt) {
    console.log(pc.dim("No pi-agent-toolkit manifest found. Nothing has been installed yet."));
    console.log(pc.dim('Run "pi-agent-toolkit install" to get started.'));
    console.log();
    return;
  }

  console.log(`${pc.dim("CLI version:")}  ${manifest.version || "unknown"}`);
  console.log(`${pc.dim("Installed at:")} ${manifest.installedAt}`);
  console.log(`${pc.dim("Updated at:")}   ${manifest.updatedAt}`);
  console.log();

  // Collect all installed names from manifest
  const installedNames = new Set<string>([
    ...manifest.installed.extensions,
    ...manifest.installed.skills.bundled,
    ...manifest.installed.skills.external,
    ...manifest.installed.prompts,
    ...manifest.installed.agents,
    ...manifest.installed.themes,
    ...manifest.installed.packages,
    ...manifest.installed.configs,
  ]);

  const entries: StatusEntry[] = [];

  for (const component of registry) {
    const isInstalled = installedNames.has(component.name);

    const path = expectedPath(component);

    if (!isInstalled) {
      // Not in manifest, but check filesystem in case it was installed
      // before the CLI existed (e.g., via install.sh or manually)
      if (path) {
        const check = checkFile(path);
        if (check.exists) {
          entries.push({
            name: component.name,
            category: component.category,
            status: "untracked",
            detail: check.detail,
          });
          continue;
        }
      }
      entries.push({
        name: component.name,
        category: component.category,
        status: "not-installed",
      });
      continue;
    }

    if (!path) {
      // Can't verify on disk (e.g., pi packages)
      entries.push({
        name: component.name,
        category: component.category,
        status: "ok",
        detail: "installed (cannot verify on disk)",
      });
      continue;
    }

    const check = checkFile(path);
    entries.push({
      name: component.name,
      category: component.category,
      status: check.exists ? "ok" : "missing",
      detail: check.detail,
    });
  }

  // Display by category
  const categories = [
    { key: "extensions", label: "Extensions" },
    { key: "skills-bundled", label: "Bundled Skills" },
    { key: "skills-external", label: "External Skills" },
    { key: "prompts", label: "Prompts" },
    { key: "agents", label: "Agents" },
    { key: "themes", label: "Themes" },
    { key: "packages", label: "Packages" },
    { key: "configs", label: "Configs" },
  ];

  for (const cat of categories) {
    const catEntries = entries.filter((e) => e.category === cat.key);
    if (catEntries.length === 0) continue;

    const tracked = catEntries.filter((e) => e.status === "ok" || e.status === "missing");
    const untracked = catEntries.filter((e) => e.status === "untracked");
    const available = catEntries.filter((e) => e.status === "not-installed");
    const totalInstalled = tracked.length + untracked.length;

    console.log(
      pc.bold(pc.cyan(cat.label)) + pc.dim(` (${totalInstalled}/${catEntries.length} installed)`),
    );

    for (const entry of tracked) {
      const icon = entry.status === "ok" ? pc.green("*") : pc.red("!");
      const detail = entry.detail ? pc.dim(` (${entry.detail})`) : "";
      const statusLabel = entry.status === "missing" ? pc.red(" MISSING") : "";
      console.log(`  ${icon} ${entry.name}${statusLabel}${detail}`);
    }

    for (const entry of untracked) {
      const detail = entry.detail ? pc.dim(` (${entry.detail})`) : "";
      console.log(
        `  ${pc.yellow("~")} ${entry.name}${detail} ${pc.yellow("(not tracked by manifest)")}`,
      );
    }

    if (available.length > 0) {
      console.log(
        pc.dim(`  ${available.length} more available: ${available.map((e) => e.name).join(", ")}`),
      );
    }

    console.log();
  }

  // Drift summary
  const missing = entries.filter((e) => e.status === "missing");
  if (missing.length > 0) {
    console.log(pc.yellow(`${missing.length} component(s) in manifest but missing from disk:`));
    for (const m of missing) {
      console.log(pc.yellow(`  - ${m.name}`));
    }
    console.log(pc.dim('Re-run "pi-agent-toolkit install" to restore them.'));
    console.log();
  }
}

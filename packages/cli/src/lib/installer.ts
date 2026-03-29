import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { resolve, basename } from "node:path";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import type { Component, ComponentCategory } from "./registry.ts";
import {
  BUNDLED_DOTFILES,
  PI_AGENT_DIR,
  PI_EXTENSIONS_DIR,
  PI_SKILLS_DIR,
  PI_PROMPTS_DIR,
  PI_AGENTS_DIR,
  PI_THEMES_DIR,
  AGENTS_SKILLS_DIR,
} from "./paths.ts";
import { recordInstall } from "./manifest.ts";

interface InstallOptions {
  link: boolean;
  repoPath?: string;
  overrideConfigs: boolean;
  cliVersion: string;
}

/** Resolve the source path for a component */
export function resolveSource(component: Component, options: InstallOptions): string {
  if (!component.source) {
    throw new Error(`Component ${component.name} has no source path`);
  }

  if (options.link && options.repoPath) {
    return resolve(options.repoPath, "dotfiles", component.source);
  }

  return resolve(BUNDLED_DOTFILES, component.source);
}

/** Resolve the target path for a component */
export function resolveTarget(component: Component): string {
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
    case "configs": {
      // Template files: auth.json.template -> auth.json, mcp.json.template -> mcp.json
      const name = (component.source ?? component.name).replace(".template", "");
      return resolve(PI_AGENT_DIR, name);
    }
    default:
      return resolve(PI_AGENT_DIR, component.name);
  }
}

/** Copy a file or directory */
function copyComponent(source: string, target: string): void {
  mkdirSync(resolve(target, ".."), { recursive: true });
  cpSync(source, target, { recursive: true });
}

/** Create a symlink, removing existing target if needed */
function linkComponent(source: string, target: string): void {
  const targetDir = resolve(target, "..");
  mkdirSync(targetDir, { recursive: true });

  if (targetExists(target)) unlinkSync(target);

  symlinkSync(source, target);
}

/** Check if anything exists at a path (including dangling symlinks) */
function targetExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Install a single component that uses copy or symlink */
function installLocal(
  component: Component,
  options: InstallOptions,
): { success: boolean; message: string } {
  const source = resolveSource(component, options);
  const target = resolveTarget(component);

  if (!existsSync(source)) {
    return { success: false, message: `Source not found: ${source}` };
  }

  // Config template protection
  if (component.isTemplate && targetExists(target) && !options.overrideConfigs) {
    return { success: true, message: "already exists (skipped)" };
  }

  try {
    // Template configs (auth.json, mcp.json) are always copied, never linked.
    // Users customize these with secrets; linking would point to placeholder templates.
    if (options.link && !component.isTemplate) {
      linkComponent(source, target);
      return { success: true, message: "linked" };
    } else {
      copyComponent(source, target);
      return { success: true, message: "copied" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}

/** Install a skill via the skills CLI (npx skills add) */
function installViaSkillsCli(component: Component): { success: boolean; message: string } {
  if (!component.remote) {
    return { success: false, message: "No remote source defined" };
  }

  try {
    let cmd = `npx skills add ${component.remote}`;
    if (component.remoteSkills?.length) {
      for (const skill of component.remoteSkills) {
        cmd += ` -s ${skill}`;
      }
    }
    cmd += " -g -y";

    execSync(cmd, { stdio: "pipe", timeout: 60_000 });
    return { success: true, message: "installed via skills CLI" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}

/** Install a package via pi install */
function installViaPi(component: Component): { success: boolean; message: string } {
  if (!component.remote) {
    return { success: false, message: "No remote source defined" };
  }

  try {
    execSync(`pi install ${component.remote}`, {
      stdio: "pipe",
      timeout: 60_000,
    });
    return { success: true, message: "installed via pi" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}

/** Install a batch of components with progress reporting */
export async function installComponents(
  components: Component[],
  options: InstallOptions,
): Promise<void> {
  if (components.length === 0) return;

  // Ensure base directories exist
  for (const dir of [
    PI_AGENT_DIR,
    PI_EXTENSIONS_DIR,
    PI_SKILLS_DIR,
    PI_PROMPTS_DIR,
    PI_AGENTS_DIR,
    PI_THEMES_DIR,
    AGENTS_SKILLS_DIR,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const spinner = p.spinner();
  const results: { name: string; success: boolean; message: string }[] = [];

  for (const component of components) {
    spinner.start(`Installing ${component.name}...`);

    let result: { success: boolean; message: string };

    switch (component.method) {
      case "copy":
      case "symlink":
        result = installLocal(component, options);
        break;
      case "skills-cli":
        result = installViaSkillsCli(component);
        break;
      case "pi-install":
        result = installViaPi(component);
        break;
      default:
        result = { success: false, message: `Unknown method: ${component.method}` };
    }

    results.push({ name: component.name, ...result });

    if (result.success) {
      spinner.stop(`${component.name}: ${result.message}`);
    } else {
      spinner.stop(`${component.name}: FAILED - ${result.message}`);
    }
  }

  // Record successful installs in manifest, grouped by category
  const successByCategory = new Map<ComponentCategory, string[]>();
  for (const r of results) {
    if (!r.success) continue;
    const component = components.find((c) => c.name === r.name);
    if (!component) continue;
    const list = successByCategory.get(component.category) ?? [];
    list.push(r.name);
    successByCategory.set(component.category, list);
  }

  for (const [category, names] of successByCategory) {
    recordInstall(names, category, options.cliVersion);
  }

  // Summary
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  if (failed > 0) {
    p.log.warn(`Installed ${succeeded}/${results.length} components. ${failed} failed:`);
    for (const r of results.filter((r) => !r.success)) {
      p.log.error(`  ${r.name}: ${r.message}`);
    }
  } else {
    p.log.success(`All ${succeeded} components installed successfully.`);
  }
}

/** Install npm dependencies for directory-based extensions that have package.json */
export function installExtensionDeps(): void {
  const extDir = PI_EXTENSIONS_DIR;
  if (!existsSync(extDir)) return;

  const entries = readdirSync(extDir);

  for (const entry of entries) {
    const fullPath = resolve(extDir, entry);
    try {
      if (!statSync(fullPath).isDirectory() || !existsSync(resolve(fullPath, "package.json"))) {
        continue;
      }
    } catch {
      // Skip entries where statSync fails (e.g. broken symlinks)
      continue;
    }

    try {
      p.log.info(`Installing dependencies for ${entry}...`);
      execSync("npm install --silent", { cwd: fullPath, stdio: "pipe" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.error(`Failed to install dependencies for ${entry}: ${msg}`);
    }
  }
}

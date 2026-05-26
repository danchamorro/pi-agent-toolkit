#!/usr/bin/env node

// setup.mjs - Zero-dependency setup script for pi-agent-toolkit.
//
// Usage:
//   node setup.mjs                Copy mode (for users)
//   node setup.mjs --link         Symlink mode (for development)
//   node setup.mjs sync           Absorb local Pi files into repo
//   node setup.mjs sync --all     Absorb all without prompting
//   node setup.mjs --help         Print usage
//
// Both copy and link modes accept:
//   --skip-external               Skip installing external skills
//   --skip-packages               Skip installing pi packages

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(__filename);
const DOTFILES = join(REPO_ROOT, "dotfiles");
const MANIFEST_PATH = join(REPO_ROOT, "manifest.json");

const HOME = process.env.PI_AGENT_TOOLKIT_HOME
  ? resolve(process.env.PI_AGENT_TOOLKIT_HOME)
  : homedir();
const PI_AGENT_DIR = join(HOME, ".pi", "agent");
const AGENTS_SKILLS_DIR = join(HOME, ".agents", "skills");
const CLAUDE_SKILLS_DIR = join(HOME, ".claude", "skills");
const PERSONAL_SKILLS_SOURCE_DIR = join(DOTFILES, "personal-skills");
const PERSONAL_SKILLS_TARGETS = [
  { root: AGENTS_SKILLS_DIR, layout: "categorized" },
  { root: CLAUDE_SKILLS_DIR, layout: "flat" },
];
const PROTECTED_SKILL_ROOTS = new Set([
  AGENTS_SKILLS_DIR,
  CLAUDE_SKILLS_DIR,
  join(PI_AGENT_DIR, "skills"),
]);

// ANSI color helpers
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ok = (msg) => console.log(`  ${GREEN}*${RESET} ${msg}`);
const fail = (msg) => console.log(`  ${RED}!${RESET} ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}~${RESET} ${msg}`);
const info = (msg) => console.log(`  ${DIM}${msg}${RESET}`);
const heading = (msg) => console.log(`\n${BOLD}${msg}${RESET}`);

// ---------------------------------------------------------------------------
// Directory mappings: [dotfiles subdir, Pi target dir]
// ---------------------------------------------------------------------------

const DIRECTORY_MAPS = [
  ["extensions", join(PI_AGENT_DIR, "extensions")],
  ["agent-skills", join(PI_AGENT_DIR, "skills")],
  ["prompts", join(PI_AGENT_DIR, "prompts")],
  ["agents", join(PI_AGENT_DIR, "agents")],
  ["themes", join(PI_AGENT_DIR, "themes")],
];

// Directories that get symlinked/copied as a whole (not entry-by-entry)
const WHOLE_DIR_MAPS = [
  ["intercepted-commands", join(PI_AGENT_DIR, "intercepted-commands")],
];

// Configs that get symlinked (--link) or copied into ~/.pi/agent/
const LINKABLE_CONFIGS = [
  "AGENTS.md",
  "APPEND_SYSTEM.md",
  "damage-control-rules.yaml",
  "models.json",
  "agent-modes.json",
];

// Template configs: always copied, never symlinked, only if target missing.
// Key = source filename in dotfiles/, value = target filename in ~/.pi/agent/
const TEMPLATE_CONFIGS = {
  "auth.json.template": "auth.json",
  "mcp.json.template": "mcp.json",
};

// Entries to skip when scanning directories (never sync or link these)
const SKIP_ENTRIES = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isRepoOwnedSymlink(p) {
  try {
    const target = readlinkSync(p);
    const absoluteTarget = isAbsolute(target) ? target : resolve(dirname(p), target);
    const compareTarget = existsSync(p) ? realpathSync(p) : absoluteTarget;
    return compareTarget === REPO_ROOT || compareTarget.startsWith(`${REPO_ROOT}${sep}`);
  } catch {
    return false;
  }
}

function isProtectedSkillPath(p) {
  for (const root of PROTECTED_SKILL_ROOTS) {
    if (isPathInside(root, p)) return true;
  }
  return false;
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

/** Remove a repo-managed path. Protected skill roots never delete unmanaged content. */
function removePath(p) {
  try {
    const stats = lstatSync(p);
    if (stats.isSymbolicLink()) {
      unlinkSync(p);
    } else if (isProtectedSkillPath(p)) {
      warn(`Preserved unmanaged skill entry: ${p}`);
    } else if (stats.isFile()) {
      unlinkSync(p);
    } else if (stats.isDirectory()) {
      rmSync(p, { recursive: true, force: true });
    }
  } catch {
    // Does not exist, nothing to remove
  }
}

function replaceWithSource(sourcePath, targetPath, useLink) {
  if (pathExists(targetPath)) {
    const stats = lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      unlinkSync(targetPath);
    } else if (isProtectedSkillPath(targetPath)) {
      warn(`Preserved unmanaged skill entry: ${targetPath}`);
      return false;
    } else {
      removePath(targetPath);
    }
  }

  if (useLink) {
    symlinkSync(sourcePath, targetPath);
  } else {
    cpSync(sourcePath, targetPath, { recursive: true });
  }
  return true;
}

/** Read and parse manifest.json */
function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    return { externalSkills: [], packages: [] };
  }
}

/** Build a Set of all external skill names from the manifest */
function getExternalSkillNames() {
  const manifest = readManifest();
  const names = new Set();
  for (const entry of manifest.externalSkills ?? []) {
    if (entry.skills?.length) {
      for (const skill of entry.skills) {
        names.add(skill);
      }
    }
    // Also add the repo name as a fallback. Covers cases where the
    // installed directory name differs from the skills list (e.g.,
    // "coleam00/excalidraw-diagram-skill" installs as "excalidraw-diagram").
    const repoName = entry.source.split("/").pop();
    if (repoName) {
      names.add(repoName);
      // Also add without common suffixes like "-skill"
      names.add(repoName.replace(/-skill$/, ""));
    }
  }
  return names;
}

/** Prompt the user for y/n */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${question} ${DIM}[Y/n]${RESET} `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "" || normalized === "y" || normalized === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Install (copy or link)
// ---------------------------------------------------------------------------

function installConfigs(useLink) {
  let count = 0;

  heading("Configs");

  // Linkable configs
  for (const name of LINKABLE_CONFIGS) {
    const source = join(DOTFILES, name);
    const target = join(PI_AGENT_DIR, name);

    if (!existsSync(source)) {
      warn(`${name} not found in dotfiles, skipping`);
      continue;
    }

    if (useLink) {
      removePath(target);
      symlinkSync(source, target);
      ok(`${name} ${DIM}-> symlinked${RESET}`);
    } else {
      removePath(target);
      cpSync(source, target);
      ok(`${name} ${DIM}-> copied${RESET}`);
    }
    count++;
  }

  // Template configs (always copy, never overwrite)
  for (const [sourceFile, targetFile] of Object.entries(TEMPLATE_CONFIGS)) {
    const source = join(DOTFILES, sourceFile);
    const target = join(PI_AGENT_DIR, targetFile);

    if (!existsSync(source)) {
      warn(`${sourceFile} not found in dotfiles, skipping`);
      continue;
    }

    if (pathExists(target)) {
      info(`${targetFile} already exists, skipping (template)`);
      continue;
    }

    cpSync(source, target);
    ok(`${targetFile} ${DIM}-> copied from template${RESET}`);
    count++;
  }

  return count;
}

function installExtensionDeps() {
  const extDir = join(PI_AGENT_DIR, "extensions");
  if (!existsSync(extDir)) return;

  for (const entry of readdirSync(extDir)) {
    const fullPath = join(extDir, entry);
    // Resolve through symlinks to check the real path
    let realPath;
    try {
      realPath = isSymlink(fullPath) ? readlinkSync(fullPath) : fullPath;
    } catch {
      continue;
    }

    try {
      if (!statSync(realPath).isDirectory()) continue;
      if (!existsSync(join(realPath, "package.json"))) continue;
    } catch {
      continue;
    }

    try {
      info(`Installing dependencies for ${entry}...`);
      execSync("npm install --silent", { cwd: realPath, stdio: "pipe" });
      ok(`${entry} dependencies installed`);
    } catch (err) {
      fail(`Failed to install dependencies for ${entry}: ${err.message}`);
    }
  }
}

function installExternalSkills() {
  const manifest = readManifest();
  const skills = manifest.externalSkills ?? [];

  if (skills.length === 0) {
    info("No external skills in manifest");
    return;
  }

  heading("External skills");

  for (const entry of skills) {
    let cmd = `npx skills add ${entry.source}`;
    if (entry.skills?.length) {
      for (const skill of entry.skills) {
        cmd += ` -s ${skill}`;
      }
    }
    cmd += " -g -y";

    info(`Installing from ${entry.source}...`);
    try {
      execSync(cmd, { stdio: "pipe", timeout: 120_000 });
      const names = entry.skills?.length
        ? entry.skills.join(", ")
        : entry.source.split("/").pop();
      ok(`${names}`);
    } catch (err) {
      fail(`Failed: ${entry.source} - ${err.message}`);
    }
  }
}

function installPackages() {
  const manifest = readManifest();
  const packages = manifest.packages ?? [];

  if (packages.length === 0) {
    info("No packages in manifest");
    return;
  }

  heading("Packages");

  for (const pkg of packages) {
    info(`Installing ${pkg}...`);
    try {
      execSync(`pi install ${pkg}`, { stdio: "pipe", timeout: 60_000 });
      ok(`${pkg}`);
    } catch (err) {
      fail(`Failed: ${pkg} - ${err.message}`);
    }
  }
}

function getPersonalSkillCategories() {
  if (!existsSync(PERSONAL_SKILLS_SOURCE_DIR)) return [];
  return readdirSync(PERSONAL_SKILLS_SOURCE_DIR).filter((category) => {
    if (SKIP_ENTRIES.has(category)) return false;
    return isDirectory(join(PERSONAL_SKILLS_SOURCE_DIR, category));
  });
}

function getPersonalSkills() {
  const skills = [];
  for (const category of getPersonalSkillCategories()) {
    const categoryDir = join(PERSONAL_SKILLS_SOURCE_DIR, category);
    for (const skill of readdirSync(categoryDir)) {
      if (SKIP_ENTRIES.has(skill)) continue;
      const skillDir = join(categoryDir, skill);
      if (!isDirectory(skillDir)) continue;
      if (!existsSync(join(skillDir, "SKILL.md"))) continue;
      skills.push({ category, skill, sourcePath: skillDir });
    }
  }
  return skills;
}

function cleanupPersonalSkillTarget(targetRoot, layout) {
  const skills = getPersonalSkills();

  for (const { skill } of skills) {
    const flatTarget = join(targetRoot, skill);
    if (isSymlink(flatTarget) && !existsSync(flatTarget)) {
      unlinkSync(flatTarget);
      warn(`Removed dangling personal skill symlink: ${skill}`);
    }
  }

  const categories = getPersonalSkillCategories();
  for (const category of categories) {
    const categoryTarget = join(targetRoot, category);
    if (!existsSync(categoryTarget) || !isDirectory(categoryTarget)) continue;

    for (const entry of readdirSync(categoryTarget)) {
      const p = join(categoryTarget, entry);
      const shouldRemove = layout === "flat" || !existsSync(p);
      if (isSymlink(p) && isRepoOwnedSymlink(p) && shouldRemove) {
        unlinkSync(p);
        warn(`Removed personal skill symlink: ${category}/${entry}`);
      }
    }

    try {
      if (readdirSync(categoryTarget).length === 0) {
        rmSync(categoryTarget, { recursive: false });
        warn(`Removed empty personal skill category: ${category}`);
      }
    } catch {
      // Directory disappeared or is not empty.
    }
  }
}

function installPersonalSkills(useLink) {
  const skills = getPersonalSkills();
  if (skills.length === 0) return 0;

  heading("personal-skills");
  let count = 0;

  for (const { root: targetRoot, layout } of PERSONAL_SKILLS_TARGETS) {
    ensureDir(targetRoot);

    cleanupPersonalSkillTarget(targetRoot, layout);

    for (const { category, skill, sourcePath } of skills) {
      const collisionPath = join(targetRoot, skill);
      const targetPath = layout === "flat" ? collisionPath : join(targetRoot, category, skill);
      if (pathExists(collisionPath) && !isRepoOwnedSymlink(collisionPath)) {
        warn(
          `personal skill ${category}/${skill} collides with existing ${collisionPath}; skipping`
        );
        continue;
      }

      if (layout === "categorized") {
        ensureDir(dirname(targetPath));
      }

      if (!replaceWithSource(sourcePath, targetPath, useLink)) continue;
      const label = layout === "flat" ? skill : `${category}/${skill}`;
      ok(`${label} ${DIM}-> ${useLink ? "symlinked" : "copied"}${RESET}`);
      count++;
    }
  }

  return count;
}

async function runInstall(useLink, skipExternal, skipPackages) {
  const mode = useLink ? "link" : "copy";
  heading(`pi-agent-toolkit setup (${mode} mode)`);

  ensureDir(PI_AGENT_DIR);

  let totalCount = 0;
  for (const [subdir, targetDir] of DIRECTORY_MAPS) {
    const sourceDir = join(DOTFILES, subdir);
    if (!existsSync(sourceDir)) continue;

    heading(subdir);
    ensureDir(targetDir);

    const entries = readdirSync(sourceDir);
    for (const entry of entries) {
      if (SKIP_ENTRIES.has(entry)) continue;

      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);

      // Skip empty directories
      if (isDirectory(sourcePath)) {
        const contents = readdirSync(sourcePath).filter((e) => !SKIP_ENTRIES.has(e));
        if (contents.length === 0) continue;
      }

      if (replaceWithSource(sourcePath, targetPath, useLink)) {
        ok(`${entry} ${DIM}-> ${useLink ? "symlinked" : "copied"}${RESET}`);
        totalCount++;
      }
    }

    // Clean dangling symlinks
    for (const entry of readdirSync(targetDir)) {
      const p = join(targetDir, entry);
      if (isSymlink(p) && isRepoOwnedSymlink(p) && !existsSync(p)) {
        unlinkSync(p);
        warn(`Removed dangling symlink: ${entry}`);
      }
    }
  }

  totalCount += installPersonalSkills(useLink);

  // Whole-directory mappings (symlink/copy the entire directory)
  for (const [subdir, targetPath] of WHOLE_DIR_MAPS) {
    const sourcePath = join(DOTFILES, subdir);
    if (!existsSync(sourcePath)) continue;

    heading(subdir);

    if (useLink) {
      removePath(targetPath);
      symlinkSync(sourcePath, targetPath);
      ok(`${subdir} ${DIM}-> symlinked (whole directory)${RESET}`);
    } else {
      removePath(targetPath);
      cpSync(sourcePath, targetPath, { recursive: true });
      ok(`${subdir} ${DIM}-> copied${RESET}`);
    }
    totalCount++;
  }

  // Configs
  installConfigs(useLink);

  // Extension npm dependencies
  heading("Dependencies");
  installExtensionDeps();

  // External skills
  if (!skipExternal) {
    installExternalSkills();
  } else {
    heading("External skills");
    info("Skipped (--skip-external)");
  }

  // Packages
  if (!skipPackages) {
    installPackages();
  } else {
    heading("Packages");
    info("Skipped (--skip-packages)");
  }

  heading("Done");
  console.log(`  ${GREEN}${totalCount} items ${mode === "link" ? "symlinked" : "copied"}${RESET}`);

  if (useLink) {
    info("Edits in dotfiles/ are immediately visible to Pi via symlinks.");
  }

  // Remind about template configs
  const authTarget = join(PI_AGENT_DIR, "auth.json");
  const mcpTarget = join(PI_AGENT_DIR, "mcp.json");
  const needsAuth = existsSync(authTarget) &&
    readFileSync(authTarget, "utf-8").includes("YOUR_");
  const needsMcp = existsSync(mcpTarget) &&
    readFileSync(mcpTarget, "utf-8").includes("YOUR_");

  if (needsAuth || needsMcp) {
    console.log("");
    warn("Template configs need your credentials:");
    if (needsAuth) info(`  Edit ${authTarget}`);
    if (needsMcp) info(`  Edit ${mcpTarget}`);
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Sync (absorb local Pi files into repo)
// ---------------------------------------------------------------------------

async function runSync(absorbAll) {
  heading("pi-agent-toolkit sync");

  const externalSkills = getExternalSkillNames();

  // Scan for unmanaged items
  const found = [];

  // Map Pi directories back to dotfiles subdirectories
  const syncTargets = [
    [join(PI_AGENT_DIR, "extensions"), "extensions", "extensions"],
    [join(PI_AGENT_DIR, "skills"), "agent-skills", "agent-skills"],
    [join(PI_AGENT_DIR, "prompts"), "prompts", "prompts"],
    [join(PI_AGENT_DIR, "agents"), "agents", "agents"],
    [join(PI_AGENT_DIR, "themes"), "themes", "themes"],
  ];

  for (const [piDir, dotfilesSub, label] of syncTargets) {
    if (!existsSync(piDir)) continue;

    const dotfilesDir = join(DOTFILES, dotfilesSub);

    for (const entry of readdirSync(piDir)) {
      if (SKIP_ENTRIES.has(entry)) continue;
      if (entry.startsWith(".")) continue;

      const piPath = join(piDir, entry);

      // Skip symlinks (already managed)
      if (isSymlink(piPath)) continue;

      // Check if it's a valid entry
      let entryIsDir;
      try {
        entryIsDir = statSync(piPath).isDirectory();
      } catch {
        continue;
      }

      // For extensions: accept .ts files and directories
      if (label === "extensions") {
        if (!entryIsDir && !entry.endsWith(".ts")) continue;
      }

      // For skills directories: only accept directories, skip external skills
      if (label === "agent-skills") {
        if (!entryIsDir) continue;
        if (externalSkills.has(entry)) continue;
      }

      found.push({
        name: entry,
        piPath,
        dotfilesDir,
        label,
        isDirectory: entryIsDir,
      });
    }
  }

  if (found.length === 0) {
    ok("Everything is in sync. No unmanaged items found.");
    console.log("");
    return;
  }

  console.log(`\n  Found ${found.length} unmanaged item(s):\n`);
  for (const item of found) {
    const suffix = item.isDirectory ? "/" : "";
    console.log(`  ${YELLOW}${item.name}${suffix}${RESET} ${DIM}(${item.label})${RESET}`);
  }
  console.log("");

  // Select what to absorb
  const toAbsorb = [];

  if (absorbAll) {
    toAbsorb.push(...found);
  } else {
    for (const item of found) {
      const suffix = item.isDirectory ? "/" : "";
      const yes = await askYesNo(
        `Absorb ${BOLD}${item.name}${suffix}${RESET} ${DIM}(${item.label})${RESET} into repo?`
      );
      if (yes) toAbsorb.push(item);
    }
  }

  if (toAbsorb.length === 0) {
    info("Nothing selected to absorb.");
    console.log("");
    return;
  }

  // Absorb
  console.log("");
  let succeeded = 0;
  let failed = 0;

  for (const item of toAbsorb) {
    const targetPath = join(item.dotfilesDir, item.name);

    try {
      ensureDir(item.dotfilesDir);

      // Copy to repo
      if (item.isDirectory) {
        cpSync(item.piPath, targetPath, { recursive: true });
        rmSync(item.piPath, { recursive: true, force: true });
      } else {
        cpSync(item.piPath, targetPath);
        unlinkSync(item.piPath);
      }

      // Symlink back
      symlinkSync(targetPath, item.piPath);

      ok(`${item.name} -> absorbed and symlinked`);
      succeeded++;
    } catch (err) {
      fail(`${item.name}: ${err.message}`);
      failed++;
    }
  }

  console.log("");
  if (failed > 0) {
    warn(`Absorbed ${succeeded}/${toAbsorb.length}. ${failed} failed.`);
  } else {
    ok(`All ${succeeded} item(s) absorbed into the repo.`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
${BOLD}pi-agent-toolkit setup${RESET}

Selectively install extensions, skills, and configs for the Pi coding agent.

${BOLD}Usage:${RESET}

  npm run setup                     Copy mode (for users / new machines)
  npm run link                      Symlink mode (for development)
  npm run dev:sync                  Link repo files, skip external skills and packages
  npm run update:third-party        Reinstall external skills and Pi packages
  npm run update:skills             Reinstall external skills only
  npm run update:packages           Reinstall Pi packages only

  node setup.mjs                    Copy mode (for users / new machines)
  node setup.mjs --link             Symlink mode (for development)
  node setup.mjs sync               Absorb local Pi files into the repo
  node setup.mjs sync --all         Absorb all without prompting
  node setup.mjs --help             Show this help

${BOLD}Flags (copy and link modes):${RESET}

  --skip-external                   Skip installing external skills (npx skills add)
  --skip-packages                   Skip installing Pi packages (pi install)

${BOLD}What it does:${RESET}

  Copy mode copies files from dotfiles/ into ~/.pi/agent/ and ~/.agents/skills/.
  Categorized personal skills from dotfiles/personal-skills/<category>/<skill>/
  are installed into ~/.agents/skills/<category>/<skill> for Pi and as flat
  entries in ~/.claude/skills/<skill> for Claude Code. They are not installed
  into ~/.pi/agent/skills/.

  Link mode symlinks files so edits in the repo are immediately visible to Pi.
  Good for development. Re-run to pick up new files or clean dangling symlinks.

  Sync scans Pi directories for files not managed by the repo (not symlinks,
  not external skills). Offers to move them into dotfiles/ and replace with
  symlinks. Use after building an extension or skill locally in Pi.

  Set PI_AGENT_TOOLKIT_HOME=/tmp/safe-home to rebase install targets under a
  throwaway home during validation. This writes to $PI_AGENT_TOOLKIT_HOME/.pi,
  $PI_AGENT_TOOLKIT_HOME/.agents, and $PI_AGENT_TOOLKIT_HOME/.claude.

  Safety: setup refuses to delete non-symlink files or directories in skill
  install roots. Unmanaged entries are reported and left in place.

${BOLD}External skills:${RESET}

  External skills are listed in manifest.json and installed via npx skills add.
  They are not committed to the repo. The manifest also serves as the exclusion
  list during sync (external skills are not offered for absorption).

${BOLD}Template configs:${RESET}

  auth.json and mcp.json are created from templates on first run and never
  overwritten. Edit them with your API keys and server configuration.
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const isSync = args.includes("sync");
const isLink = args.includes("--link");
const skipExternal = args.includes("--skip-external");
const skipPackages = args.includes("--skip-packages");
const syncAll = args.includes("--all");

if (isSync) {
  await runSync(syncAll);
} else {
  await runInstall(isLink, skipExternal, skipPackages);
}

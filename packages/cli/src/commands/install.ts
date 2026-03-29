import * as p from "@clack/prompts";
import pc from "picocolors";
import { registry, getByCategory, type Component } from "../lib/registry.ts";
import { checkRecommendations } from "../lib/warnings.ts";
import { installComponents, installExtensionDeps } from "../lib/installer.ts";

interface InstallArgs {
  all?: boolean;
  overrideConfigs?: boolean;
  link?: boolean;
  repoPath?: string;
  extensions?: string[];
  skills?: string[];
  packages?: string[];
  version: string;
}

const SELECT_ALL = "__all__";

/** Prompt a multiselect and handle cancellation. Returns selected names. */
async function selectComponents(message: string, components: Component[]): Promise<string[]> {
  if (components.length === 0) return [];

  const result = await p.multiselect({
    message: `${message} ${pc.dim("(space = toggle, enter = confirm, enter with none = skip)")}`,
    options: [
      { value: SELECT_ALL, label: "* Select all", hint: `all ${components.length} items` },
      ...components.map((c) => ({
        value: c.name,
        label: c.name,
        hint: c.description,
      })),
    ],
    required: false,
  });

  if (p.isCancel(result)) {
    p.cancel("Installation cancelled.");
    process.exit(0);
  }

  const selected = result as string[];
  if (selected.includes(SELECT_ALL)) {
    return components.map((c) => c.name);
  }
  return selected;
}

/** Run the interactive step-by-step picker */
async function interactivePicker(): Promise<Component[]> {
  const selected: string[] = [];

  const steps: { message: string; components: Component[] }[] = [
    { message: "Select extensions to install:", components: getByCategory("extensions") },
    { message: "Select bundled skills to install:", components: getByCategory("skills-bundled") },
    {
      message: "Select external skills to install (fetched from source repos):",
      components: getByCategory("skills-external"),
    },
    { message: "Select prompts to install:", components: getByCategory("prompts") },
    { message: "Select agents to install:", components: getByCategory("agents") },
    { message: "Select themes to install:", components: getByCategory("themes") },
    { message: "Select pi packages to install:", components: getByCategory("packages") },
    {
      message: "Select starter configs (copied as templates, won't overwrite existing):",
      components: getByCategory("configs"),
    },
  ];

  for (const step of steps) {
    const names = await selectComponents(step.message, step.components);
    selected.push(...names);
  }

  return registry.filter((c) => selected.includes(c.name));
}

/** Resolve component names passed via flags */
function resolveFromFlags(args: InstallArgs): Component[] {
  const names = new Set([
    ...(args.extensions ?? []),
    ...(args.skills ?? []),
    ...(args.packages ?? []),
  ]);

  const resolved: Component[] = [];
  const notFound: string[] = [];

  for (const name of names) {
    const component = registry.find((c) => c.name === name);
    if (component) resolved.push(component);
    else notFound.push(name);
  }

  if (notFound.length > 0) {
    p.log.warn(`Unknown components: ${notFound.join(", ")}`);
    p.log.info('Run "pi-agent-toolkit list" to see available components.');
  }

  return resolved;
}

export async function runInstall(args: InstallArgs): Promise<void> {
  p.intro(pc.bold("pi-agent-toolkit install"));

  // Validate --link requires --repo-path
  if (args.link && !args.repoPath) {
    p.log.error("--link requires --repo-path to be set.");
    p.log.info("Example: pi-agent-toolkit install --link --repo-path ~/Code/pi-agent-toolkit");
    process.exit(1);
  }

  // Determine what to install
  let components: Component[];

  if (args.all) {
    components = [...registry];
    p.log.info(`Installing all ${components.length} components...`);
  } else if (args.extensions || args.skills || args.packages) {
    components = resolveFromFlags(args);
  } else {
    components = await interactivePicker();
  }

  if (components.length === 0) {
    p.log.warn("Nothing selected to install.");
    p.outro("Done.");
    return;
  }

  // Show summary
  const counts: [string, number][] = [
    ["extension", components.filter((c) => c.category === "extensions").length],
    ["skill", components.filter((c) => c.category.startsWith("skills-")).length],
    ["prompt", components.filter((c) => c.category === "prompts").length],
    ["agent", components.filter((c) => c.category === "agents").length],
    ["theme", components.filter((c) => c.category === "themes").length],
    ["package", components.filter((c) => c.category === "packages").length],
    ["config", components.filter((c) => c.category === "configs").length],
  ];
  const summary = counts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}${n > 1 ? "s" : ""}`)
    .join(", ");

  p.log.info(`Will install: ${summary}`);

  if (args.link) {
    p.log.info(`Mode: symlink (repo: ${args.repoPath})`);
  }
  if (args.overrideConfigs) {
    p.log.warn("Config override enabled: existing configs will be overwritten.");
  }

  // Check soft dependency warnings
  const proceed = await checkRecommendations(components);
  if (!proceed) {
    p.log.info("Go back and adjust your selections, then re-run.");
    p.outro("Cancelled.");
    return;
  }

  // Install
  await installComponents(components, {
    link: args.link ?? false,
    repoPath: args.repoPath,
    overrideConfigs: args.overrideConfigs ?? false,
    cliVersion: args.version,
  });

  // Install npm deps for directory-based extensions
  const hasDirectoryExtensions = components.some(
    (c) => c.category === "extensions" && c.isDirectory,
  );
  if (hasDirectoryExtensions) {
    installExtensionDeps();
  }

  p.outro(pc.green("Installation complete!"));
}

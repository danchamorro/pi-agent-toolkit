import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { runInstall } from "./commands/install.ts";
import { runList } from "./commands/list.ts";
import { runStatus } from "./commands/status.ts";
import { runSync } from "./commands/sync.ts";
import { runUpdate } from "./commands/update.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
).version;

const install = defineCommand({
  meta: {
    name: "install",
    description: "Install extensions, skills, packages, and configs",
  },
  args: {
    all: {
      type: "boolean",
      description: "Install all available components",
      default: false,
    },
    "override-configs": {
      type: "boolean",
      description: "Overwrite existing config files",
      default: false,
    },
    link: {
      type: "boolean",
      description: "Symlink to local repo clone instead of copying",
      default: false,
    },
    "repo-path": {
      type: "string",
      description: "Path to local pi-agent-toolkit repo clone (required with --link)",
    },
    extensions: {
      type: "string",
      description: "Extensions to install (space-separated names)",
    },
    skills: {
      type: "string",
      description: "Skills to install (space-separated names)",
    },
    packages: {
      type: "string",
      description: "Packages to install (space-separated names)",
    },
  },
  run({ args }) {
    // Citty doesn't natively support variadic args, so we split on spaces
    // and also handle comma-separated values for convenience
    const splitArg = (val?: string): string[] | undefined => {
      if (!val) return undefined;
      return val
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    };

    return runInstall({
      all: args.all,
      overrideConfigs: args["override-configs"],
      link: args.link,
      repoPath: args["repo-path"],
      extensions: splitArg(args.extensions),
      skills: splitArg(args.skills),
      packages: splitArg(args.packages),
      version: CLI_VERSION,
    });
  },
});

const list = defineCommand({
  meta: {
    name: "list",
    description: "Browse all available components",
  },
  run() {
    runList();
  },
});

const status = defineCommand({
  meta: {
    name: "status",
    description: "Show installed components and detect drift",
  },
  run() {
    runStatus();
  },
});

const sync = defineCommand({
  meta: {
    name: "sync",
    description: "Absorb unmanaged extensions and skills from pi into the repo",
  },
  args: {
    "repo-path": {
      type: "string",
      description: "Path to local pi-agent-toolkit repo clone",
      required: true,
    },
    all: {
      type: "boolean",
      description: "Absorb all unmanaged items without prompting",
      default: false,
    },
  },
  run({ args }) {
    return runSync({
      repoPath: args["repo-path"],
      all: args.all,
    });
  },
});

const update = defineCommand({
  meta: {
    name: "update",
    description: "Update pi-agent-toolkit to the latest version",
  },
  run() {
    runUpdate(CLI_VERSION);
  },
});

const main = defineCommand({
  meta: {
    name: "pi-agent-toolkit",
    version: CLI_VERSION,
    description:
      "Selectively install curated extensions, skills, and configs for the pi coding agent",
  },
  subCommands: {
    install,
    list,
    status,
    sync,
    update,
  },
});

runMain(main);

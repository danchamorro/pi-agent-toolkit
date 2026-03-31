export type ComponentCategory =
  | "extensions"
  | "skills-bundled"
  | "skills-external"
  | "packages"
  | "configs"
  | "prompts"
  | "agents"
  | "themes";

export type InstallMethod = "copy" | "symlink" | "skills-cli" | "pi-install";

export type ExtensionGroup = "safety" | "search" | "tasks" | "ui" | "review" | "workflow" | "tools";

export interface Component {
  name: string;
  category: ComponentCategory;
  group?: ExtensionGroup;
  description: string;
  method: InstallMethod;
  /** Relative path within dotfiles/ (for copy/symlink methods) */
  source?: string;
  /** Target directory override (defaults based on category) */
  target?: string;
  /** npm package or skills-cli source for remote installs */
  remote?: string;
  /** Skills to install from a remote source */
  remoteSkills?: string[];
  /** Other component names this works best with */
  recommends?: string[];
  /** Whether this is a directory-based component */
  isDirectory?: boolean;
  /** Whether this is a template file (copy-only, never overwrite without flag) */
  isTemplate?: boolean;
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

const extensions: Component[] = [
  // Safety
  {
    name: "damage-control",
    category: "extensions",
    group: "safety",
    description: "Safety guardrail engine: blocks destructive commands, enforces path access rules",
    method: "copy",
    source: "extensions/damage-control",
    isDirectory: true,
    recommends: ["damage-control-rules.yaml"],
  },
  {
    name: "commit-approval",
    category: "extensions",
    group: "safety",
    description: "Intercepts git commits for interactive review before execution",
    method: "copy",
    source: "extensions/commit-approval.ts",
  },
  {
    name: "pr-approval",
    category: "extensions",
    group: "safety",
    description: "Intercepts PR creation for interactive review",
    method: "copy",
    source: "extensions/pr-approval.ts",
  },
  {
    name: "dirty-repo-guard",
    category: "extensions",
    group: "safety",
    description: "Warns when working in a repo with uncommitted changes",
    method: "copy",
    source: "extensions/dirty-repo-guard.ts",
  },

  // Search
  {
    name: "exa-search-tool",
    category: "extensions",
    group: "search",
    description: "Registers Exa as a semantic web search tool",
    method: "copy",
    source: "extensions/exa-search-tool.ts",
  },
  {
    name: "exa-enforce",
    category: "extensions",
    group: "search",
    description: "Enforces Exa over ad-hoc web search methods",
    method: "copy",
    source: "extensions/exa-enforce.ts",
    recommends: ["exa-search-tool"],
  },

  // Tasks
  {
    name: "tilldone",
    category: "extensions",
    group: "tasks",
    description: "Task list management with progress tracking",
    method: "copy",
    source: "extensions/tilldone.ts",
  },
  {
    name: "todos",
    category: "extensions",
    group: "tasks",
    description: "File-based todo management",
    method: "copy",
    source: "extensions/todos.ts",
  },
  {
    name: "loop",
    category: "extensions",
    group: "tasks",
    description: "Loop execution with breakout conditions",
    method: "copy",
    source: "extensions/loop.ts",
  },

  // UI
  {
    name: "btw",
    category: "extensions",
    group: "ui",
    description: "Overlay chat panel with scroll support",
    method: "copy",
    source: "extensions/btw.ts",
  },
  {
    name: "control",
    category: "extensions",
    group: "ui",
    description: "Session control and summarization",
    method: "copy",
    source: "extensions/control.ts",
  },
  {
    name: "context",
    category: "extensions",
    group: "ui",
    description: "TUI showing loaded extensions, skills, and token usage",
    method: "copy",
    source: "extensions/context.ts",
  },
  {
    name: "files",
    category: "extensions",
    group: "ui",
    description: "File picker with quick actions (reveal, open, edit, diff)",
    method: "copy",
    source: "extensions/files.ts",
  },
  {
    name: "session-breakdown",
    category: "extensions",
    group: "ui",
    description: "Session cost and usage analytics with calendar heatmap",
    method: "copy",
    source: "extensions/session-breakdown.ts",
  },
  {
    name: "term-notify",
    category: "extensions",
    group: "ui",
    description: "Desktop notifications on agent completion (cmux + OSC 777)",
    method: "copy",
    source: "extensions/term-notify.ts",
  },

  // Review
  {
    name: "review",
    category: "extensions",
    group: "review",
    description: "Code review: PR review, branch diffs, uncommitted changes",
    method: "copy",
    source: "extensions/review.ts",
  },

  // Workflow
  {
    name: "question-mode",
    category: "extensions",
    group: "workflow",
    description: "Read-only question mode (no file changes)",
    method: "copy",
    source: "extensions/question-mode.ts",
  },
  {
    name: "qna-interactive",
    category: "extensions",
    group: "workflow",
    description: "Structured Q&A mode",
    method: "copy",
    source: "extensions/qna-interactive.ts",
  },
  {
    name: "require-session-name-on-exit",
    category: "extensions",
    group: "workflow",
    description: "Prompts for session name before exit",
    method: "copy",
    source: "extensions/require-session-name-on-exit.ts",
  },

  // Tools
  {
    name: "tools",
    category: "extensions",
    group: "tools",
    description: "Custom tool registrations",
    method: "copy",
    source: "extensions/tools.ts",
  },
  {
    name: "uv",
    category: "extensions",
    group: "tools",
    description: "Intercepts pip/python calls and redirects to uv",
    method: "copy",
    source: "extensions/uv.ts",
  },
  {
    name: "execute-command",
    category: "extensions",
    group: "tools",
    description: "Slash command execution",
    method: "copy",
    source: "extensions/execute-command",
    isDirectory: true,
  },
];

// ---------------------------------------------------------------------------
// Bundled skills
// ---------------------------------------------------------------------------

const bundledSkills: Component[] = [
  {
    name: "brainstorm",
    category: "skills-bundled",
    description: "Interview-driven plan stress-testing",
    method: "copy",
    source: "global-skills/brainstorm",
    target: "global-skills",
    isDirectory: true,
  },
  {
    name: "code-review",
    category: "skills-bundled",
    description: "AI-powered code review using CodeRabbit CLI",
    method: "copy",
    source: "global-skills/code-review",
    target: "global-skills",
    isDirectory: true,
  },
  {
    name: "cli-detector",
    category: "skills-bundled",
    description: "Scan repos for service integrations and their CLIs",
    method: "copy",
    source: "global-skills/cli-detector",
    target: "global-skills",
    isDirectory: true,
  },
  {
    name: "exa-search",
    category: "skills-bundled",
    description: "Semantic web search via Exa API",
    method: "copy",
    source: "agent-skills/exa-search",
    target: "agent-skills",
    isDirectory: true,
  },
  {
    name: "gh-issue-creator",
    category: "skills-bundled",
    description: "Create GitHub issues via gh CLI with consistent formatting",
    method: "copy",
    source: "global-skills/gh-issue-creator",
    target: "global-skills",
    isDirectory: true,
  },
  {
    name: "google-chat-cards-v2",
    category: "skills-bundled",
    description: "Google Chat Cards v2 format for rich alert notifications",
    method: "copy",
    source: "global-skills/google-chat-cards-v2",
    target: "global-skills",
    isDirectory: true,
  },
  {
    name: "technical-docs",
    category: "skills-bundled",
    description: "Technical documentation standards and best practices",
    method: "copy",
    source: "global-skills/technical-docs",
    target: "global-skills",
    isDirectory: true,
  },
  {
    name: "whats-new",
    category: "skills-bundled",
    description: "Git changelog generation between branches",
    method: "copy",
    source: "global-skills/whats-new",
    target: "global-skills",
    isDirectory: true,
  },
];

// ---------------------------------------------------------------------------
// External skills (installed via npx skills add)
// ---------------------------------------------------------------------------

const externalSkills: Component[] = [
  {
    name: "docx",
    category: "skills-external",
    description: "Create, read, edit, and manipulate Word documents",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["docx"],
  },
  {
    name: "pdf",
    category: "skills-external",
    description: "Read, merge, split, create, and manipulate PDF files",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["pdf"],
  },
  {
    name: "pptx",
    category: "skills-external",
    description: "Create and edit PowerPoint presentations",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["pptx"],
  },
  {
    name: "xlsx",
    category: "skills-external",
    description: "Create, read, and edit spreadsheet files",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["xlsx"],
  },
  {
    name: "frontend-design",
    category: "skills-external",
    description: "Production-grade frontend interfaces with high design quality",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["frontend-design"],
  },
  {
    name: "skill-creator",
    category: "skills-external",
    description: "Create, modify, and measure skill performance",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["skill-creator"],
  },
  {
    name: "agent-browser",
    category: "skills-external",
    description: "Browser automation for agents",
    method: "skills-cli",
    remote: "anthropics/skills",
    remoteSkills: ["agent-browser"],
  },
  {
    name: "vercel-react-best-practices",
    category: "skills-external",
    description: "React best practices from Vercel",
    method: "skills-cli",
    remote: "vercel-labs/skills",
    remoteSkills: ["vercel-react-best-practices"],
  },
  {
    name: "web-design-guidelines",
    category: "skills-external",
    description: "Web design guidelines and patterns",
    method: "skills-cli",
    remote: "vercel-labs/skills",
    remoteSkills: ["web-design-guidelines"],
  },
  {
    name: "find-skills",
    category: "skills-external",
    description: "Discover and install agent skills",
    method: "skills-cli",
    remote: "vercel-labs/skills",
    remoteSkills: ["find-skills"],
  },
  {
    name: "learn-codebase",
    category: "skills-external",
    description: "Discover project conventions and surface security concerns",
    method: "skills-cli",
    remote: "HazAT/pi-config",
    remoteSkills: ["learn-codebase"],
  },
  {
    name: "self-improve",
    category: "skills-external",
    description: "Self-improvement and reflection for agents",
    method: "skills-cli",
    remote: "HazAT/pi-config",
    remoteSkills: ["self-improve"],
  },
  {
    name: "cmux",
    category: "skills-external",
    description: "Control cmux topology: windows, workspaces, panes, focus",
    method: "skills-cli",
    remote: "manaflow-ai/cmux",
    remoteSkills: ["cmux"],
  },
  {
    name: "cmux-and-worktrees",
    category: "skills-external",
    description: "Parallel development with cmux-style git worktrees",
    method: "skills-cli",
    remote: "manaflow-ai/cmux",
    remoteSkills: ["cmux-and-worktrees"],
  },
  {
    name: "cmux-browser",
    category: "skills-external",
    description: "Browser automation with cmux surfaces",
    method: "skills-cli",
    remote: "manaflow-ai/cmux",
    remoteSkills: ["cmux-browser"],
  },
  {
    name: "cmux-debug-windows",
    category: "skills-external",
    description: "Manage cmux debug windows and debug menu wiring",
    method: "skills-cli",
    remote: "manaflow-ai/cmux",
    remoteSkills: ["cmux-debug-windows"],
  },
  {
    name: "cmux-markdown",
    category: "skills-external",
    description: "Open markdown files in a formatted viewer panel with live reload",
    method: "skills-cli",
    remote: "manaflow-ai/cmux",
    remoteSkills: ["cmux-markdown"],
  },
  {
    name: "vue-best-practices",
    category: "skills-external",
    description: "Vue 3 Composition API with TypeScript best practices",
    method: "skills-cli",
    remote: "hyf0/vue-skills",
    remoteSkills: ["vue-best-practices"],
  },
  {
    name: "systematic-debugging",
    category: "skills-external",
    description: "Systematic approach to debugging and test failures",
    method: "skills-cli",
    remote: "obra/superpowers",
    remoteSkills: ["systematic-debugging"],
  },
  {
    name: "writing-skills",
    category: "skills-external",
    description: "Create and verify skills before deployment",
    method: "skills-cli",
    remote: "obra/superpowers",
    remoteSkills: ["writing-skills"],
  },
  {
    name: "code-simplifier",
    category: "skills-external",
    description: "Simplify and refine code for clarity and maintainability",
    method: "skills-cli",
    remote: "getsentry/skills",
    remoteSkills: ["code-simplifier"],
  },
  {
    name: "iterate-pr",
    category: "skills-external",
    description: "Iterate on a PR until CI passes",
    method: "skills-cli",
    remote: "getsentry/skills",
    remoteSkills: ["iterate-pr"],
  },
  {
    name: "playwright-cli",
    category: "skills-external",
    description: "Automate browser interactions and Playwright tests",
    method: "skills-cli",
    remote: "microsoft/playwright-cli",
  },
  {
    name: "firecrawl",
    category: "skills-external",
    description: "Web scraping, search, crawling, and page interaction",
    method: "skills-cli",
    remote: "firecrawl/cli",
    remoteSkills: ["firecrawl"],
  },
  {
    name: "excalidraw-diagram",
    category: "skills-external",
    description: "Create Excalidraw diagram JSON files for visual workflows",
    method: "skills-cli",
    remote: "coleam00/excalidraw-diagram-skill",
  },
];

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

const packages: Component[] = [
  {
    name: "agent-modes",
    category: "packages",
    description: "Switch between code, architect, debug, ask, and review modes",
    method: "pi-install",
    remote: "npm:@danchamorro/pi-agent-modes",
  },
  {
    name: "prompt-enhancer",
    category: "packages",
    description: "Rewrite prompts to be clearer and more actionable before sending",
    method: "pi-install",
    remote: "npm:@danchamorro/pi-prompt-enhancer",
  },
];

// ---------------------------------------------------------------------------
// Configs (starter templates)
// ---------------------------------------------------------------------------

const configs: Component[] = [
  {
    name: "AGENTS.md",
    category: "configs",
    description: "Global agent rules: git safety, commit style, code style",
    method: "copy",
    source: "AGENTS.md",
    isTemplate: true,
  },
  {
    name: "APPEND_SYSTEM.md",
    category: "configs",
    description: "System prompt: reasoning quality, jCodeMunch policy, writing style",
    method: "copy",
    source: "APPEND_SYSTEM.md",
    isTemplate: true,
  },
  {
    name: "settings.json",
    category: "configs",
    description: "Pi settings: default provider, model, compaction",
    method: "copy",
    source: "settings.json.template",
    isTemplate: true,
  },
  {
    name: "models.json",
    category: "configs",
    description: "Custom provider definitions (e.g., local MLX models)",
    method: "copy",
    source: "models.json",
    isTemplate: true,
  },
  {
    name: "agent-modes.json",
    category: "configs",
    description: "Per-mode model and thinking overrides",
    method: "copy",
    source: "agent-modes.json",
    isTemplate: true,
  },
  {
    name: "damage-control-rules.yaml",
    category: "configs",
    description: "Safety rules: bash patterns, path access, delete protection",
    method: "copy",
    source: "damage-control-rules.yaml",
    isTemplate: true,
    recommends: ["damage-control"],
  },
  {
    name: "auth.json",
    category: "configs",
    description: "API key configuration (created from template)",
    method: "copy",
    source: "auth.json.template",
    isTemplate: true,
  },
  {
    name: "mcp.json",
    category: "configs",
    description: "MCP server configuration (created from template)",
    method: "copy",
    source: "mcp.json.template",
    isTemplate: true,
  },
];

// ---------------------------------------------------------------------------
// Full registry
// ---------------------------------------------------------------------------

export const registry: Component[] = [
  ...extensions,
  ...bundledSkills,
  ...externalSkills,
  ...packages,
  ...configs,

  // Placeholders: no items yet, but the categories are ready for content.
  // Add prompts, agents, and themes entries here as they're created.
];

/** Get components by category */
export function getByCategory(category: ComponentCategory): Component[] {
  return registry.filter((c) => c.category === category);
}

/** Get extension groups with their components */
export function getExtensionGroups(): Record<ExtensionGroup, Component[]> {
  return getByCategory("extensions").reduce<Record<ExtensionGroup, Component[]>>(
    (acc, ext) => {
      const key = (ext.group ?? "tools") as ExtensionGroup;
      if (!acc[key]) acc[key] = [];
      acc[key].push(ext);
      return acc;
    },
    {} as Record<ExtensionGroup, Component[]>,
  );
}

/** Group label for display */
export const GROUP_LABELS: Record<ExtensionGroup, string> = {
  safety: "Safety",
  search: "Search",
  tasks: "Tasks",
  ui: "UI & Session",
  review: "Review",
  workflow: "Workflow",
  tools: "Tools",
};

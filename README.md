# pi-agent-toolkit

My personal, versioned setup for the
[Pi](https://github.com/earendil-works/pi) coding agent, with extensions,
skills, configs, safety guardrails, and installable packages. This is a
public backup and reference for how I organize my own agent environment,
not a universal starter kit intended to be cloned unchanged by everyone.

Includes 26 extensions, 61 skills, 1 prompt template, 1 theme,
8 installable Pi packages, MCP server configurations, and safety guardrails.
It also tracks 2 custom sub-agent roles for local use with the subagents
package.

---

## Quick start

### For users (copy mode)

Clone and run:

```bash
git clone https://github.com/danchamorro/pi-agent-toolkit.git
cd pi-agent-toolkit
node setup.mjs
```

This copies everything into the right Pi and Claude Code directories.
Template configs (`auth.json`, `mcp.json`) are created only if they don't
already exist.

For full functionality on a new machine, review the prerequisites in
[`dotfiles/SETUP.md`](dotfiles/SETUP.md). Some helper tools, including
`opensrc` for dependency source lookups, Tirith for local terminal
security, and RTK for shell-output token savings, are documented there
rather than installed by this repo.

Skip external skills or packages if you don't want them:

```bash
npm run setup -- --skip-external --skip-packages
```

### For development (link mode)

Symlink files so edits in the repo are immediately visible to Pi:

```bash
npm run link
```

Re-run any time to pick up new files or clean dangling symlinks. Template
configs with secrets are never symlinked.

Day to day personal skill workflow:

1. Create or edit a skill under `dotfiles/personal-skills/<category>/<skill>/`.
2. Run `npm run dev:sync`.
3. Reload Pi or Claude Code if the running agent does not pick up new skills automatically.

`dev:sync` uses link mode and skips external skills and Pi package refreshes.

### Bringing outside work into the repo

Prefer repo-first development: create the file under `dotfiles/` or
`packages/`, then run `npm run dev:sync` so the live Pi copy is a symlink.
If you prototype directly in Pi-owned directories, absorb the unmanaged
files back into the repo:

```bash
node setup.mjs sync
```

`sync` scans live Pi directories and maps accepted files back to repo-owned
paths:

| Live path | Repo path after sync |
|---|---|
| `~/.pi/agent/extensions/` | `dotfiles/extensions/` |
| `~/.pi/agent/skills/` | `dotfiles/agent-skills/` |
| `~/.pi/agent/agents/` | `dotfiles/agents/` |
| `~/.pi/agent/prompts/` | `dotfiles/prompts/` |
| `~/.pi/agent/themes/` | `dotfiles/themes/` |

It ignores existing symlinks and manifest-listed external skills, prompts
for each unmanaged item, moves accepted files into `dotfiles/`, and replaces
the live file with a symlink. Use `--all` to skip the interactive prompts.

`sync` does not scan `~/.agents/skills/` or `~/.claude/skills/`. For
cross-agent personal skills, manually move or copy the skill to
`dotfiles/personal-skills/<category>/<skill>/`, then run
`npm run dev:sync`.

For third-party work installed with `npx skills add` or `pi install`, track
it in `manifest.json` instead of committing the generated installed files.

### Full usage

```
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
node setup.mjs --help             Show help

Flags (copy and link modes):
  --skip-external                 Skip installing external skills
  --skip-packages                 Skip installing Pi packages
```

### Updating third-party skills and packages

Re-run the manifest-driven installers periodically to pull the latest
third-party marketplace skills and Pi packages:

```bash
npm run update:third-party
```

Use the narrower commands when you only want one category:

```bash
npm run update:skills     # External skills from manifest.json
npm run update:packages   # Pi packages from manifest.json
```

---

## What's in this repo

### Packages (installable via pi)

This setup installs eight Pi packages via `manifest.json`:

```bash
pi install npm:@danchamorro/pi-subagents
pi install npm:@danchamorro/pi-agent-modes
pi install npm:@danchamorro/pi-prompt-enhancer
pi install npm:pi-design-deck
pi install npm:pi-annotate
pi install npm:@narumitw/pi-goal
pi install git:https://github.com/badlogic/pi-diff-review
pi install git:github.com/DietrichGebert/ponytail
```

**Published from this repo:**

| Package | Description | npm |
|---|---|---|
| [subagents](packages/subagents) | Run in-process background sub-agents with bundled planner, reviewer, scout, and worker roles plus main-session feedback handoff | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-subagents)](https://www.npmjs.com/package/@danchamorro/pi-subagents) |
| [agent-modes](packages/agent-modes) | Switch between code, architect, debug, ask, and review modes with enforced tool restrictions, bash allowlists, and per-mode model assignment | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-agent-modes)](https://www.npmjs.com/package/@danchamorro/pi-agent-modes) |
| [prompt-enhancer](packages/prompt-enhancer) | Rewrite prompts to be clearer and more actionable before sending | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-prompt-enhancer)](https://www.npmjs.com/package/@danchamorro/pi-prompt-enhancer) |

**Also installed as part of this setup:**

| Package | Description | Source |
|---|---|---|
| `pi-design-deck` | Present multi-slide visual decision decks with high-fidelity previews. Bundles the `design-deck` skill used in this setup. | [nicobailon/pi-design-deck](https://github.com/nicobailon/pi-design-deck) |
| `pi-annotate` | Visual browser annotation for AI-assisted UI debugging. Adds `/annotate` plus companion Chrome extension tooling. | [nicobailon/pi-annotate](https://github.com/nicobailon/pi-annotate) |
| `@narumitw/pi-goal` | Goal-driven task completion for Pi. Adds `/goal` mode plus `goal_complete` for verifiable long-running work. | [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) |
| `pi-diff-review` | Native diff review window for Pi. Adds a `/diff-review` command that opens changed files in a Monaco diff editor and turns review notes into a prompt back in Pi. | [badlogic/pi-diff-review](https://github.com/badlogic/pi-diff-review) |
| `ponytail` | Lazy senior developer mode for Pi. Adds `/ponytail` controls, prompt injection, and simplification-focused skills. | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |

### Extensions (26)

All extensions live in `dotfiles/extensions/`.

**Safety and workflow:**

| Extension | What it does |
|-----------|-------------|
| `damage-control/` | Safety guardrail engine: blocks destructive commands, enforces path access rules, prevents accidental deletes |
| `commit-approval.ts` | Intercepts git commits for interactive review before execution |
| `pr-approval.ts` | Intercepts PR creation for interactive review |
| `dirty-repo-guard.ts` | Warns when working in a repo with uncommitted changes |
| `require-session-name-on-exit.ts` | Prompts for a session name before `/quit`, `/q`, `/safe-quit`, or Ctrl+Shift+Q exits |

**Search, tools, and experimental providers:**

| Extension | What it does |
|-----------|-------------|
| `exa-search-tool.ts` | Registers Exa as a semantic web search tool |
| `exa-enforce.ts` | Enforces Exa over ad-hoc web search methods |
| `tilldone.ts` | Task list management with progress tracking |
| `tools.ts` | Custom tool registrations |

**UI and session management:**

| Extension | What it does |
|-----------|-------------|
| `btw.ts` | Overlay chat panel with scroll support |
| `control.ts` | Session control and summarization |
| `loop.ts` | Loop execution with breakout conditions |
| `context.ts` | TUI showing loaded extensions, skills, token usage |
| `coach.ts` | Recommends underused Pi workflows based on session habits |
| `files.ts` | File picker with quick actions (reveal, open, edit, diff) |
| `review.ts` | Code review: PR review, branch diffs, uncommitted changes |
| `session-breakdown.ts` | Session cost/usage analytics with calendar heatmap |
| `find-session.ts` | Search past Pi sessions with LLM ranking and one-step resume |
| `todos.ts` | File-based todo management |
| `term-notify.ts` | Desktop notifications on agent completion (cmux + OSC 777) |
| `qna-interactive.ts` | Structured Q&A mode |
| `question-mode.ts` | Read-only question mode (no file changes) |
| `clean-sessions.ts` | Prunes old, low-value session files |
| `inventory.ts` | Reopens Pi's startup-style resource inventory as a tabbed TUI overlay with scope grouping and descriptions |
| `uv.ts` | Intercepts pip/python calls and redirects to uv |

**Terminal integration:**

| Extension | What it does |
|-----------|-------------|
| `warp-split-fork.ts` | Forks the current Pi session into Warp via `/warp-tab-fork` (new tab) or `/warp-pane-fork` (new pane, macOS experimental) |

### Skills

This repo distinguishes several skill types so each one has one clear owner
and install path:

- **Personal skills** are user-authored skills committed to this repo under
  `dotfiles/personal-skills/<category>/<skill>/`. They install to
  `~/.agents/skills/<category>/<skill>` for Pi and flat to
  `~/.claude/skills/<skill>` for Claude Code, because Claude Code does not
  discover nested skill directories. Repo-managed personal skills are not
  linked into `~/.pi/agent/skills/`.
- **Pi-only skills** live under `dotfiles/agent-skills/` and install to
  `~/.pi/agent/skills/`. Use these for Pi-specific workflows that should not
  be shared with Claude Code.
- **Project-local skills** belong in a project's own agent configuration,
  not in this personal setup repo.
- **Third-party skills** are listed in `manifest.json` and installed by
  `npx skills add`. They are not committed here and may still be placed by
  third-party tooling under `~/.agents/skills/` or `~/.pi/agent/skills/`.
- **Package-provided skills** ship with installed Pi packages from
  `manifest.json`.

Setup refuses to delete non-symlink files or directories in skill install
roots. Unmanaged and third-party directories are reported and left in place.

**Personal skills** (20, committed to this repo):

| Category | Skill | Description |
|----------|-------|-------------|
| `security-environment` | `1password-developer` | 1Password SSH agent, Environments, and op CLI workflows |
| `planning` | `brainstorm` | Interview-driven plan stress-testing |
| `engineering` | `api-contract-validator` | Validate API clients and integrations against contracts, schemas, SDK types, and documented request/response behavior |
| `developer-workflow` | `cli-detector` | Discover repo SaaS integrations and identify official provider CLIs for setup, debugging, and automation |
| `engineering` | `code-structure-cleanup` | Behavior-preserving cleanup after working features have duplicated mechanics or messy structure |
| `engineering` | `debug-mantra` | Four-step debugging discipline for reproducing, tracing, falsifying, and cross-checking bugs |
| `developer-workflow` | `gh-issue-creator` | Create GitHub issues via `gh` CLI |
| `docs-communication` | `google-chat-cards-v2` | Google Chat Cards v2 notifications |
| `docs-communication` | `management-talk` | Rewrite engineering updates for leadership, Slack, standups, email, and meeting notes |
| `engineering` | `post-mortem` | Produce engineering root-cause writeups after fixed and validated bugs |
| `planning` | `plan-reviewer` | Review implementation plans for evidence, trackability, dependencies, risks, and validation before execution |
| `engineering` | `scrutinize` | Outsider-perspective review of plans, PRs, diffs, and code changes |
| `developer-workflow` | `sql-specialist` | Write, review, explain, and optimize SQL queries, schemas, DDL, ERDs, and execution plans |
| `docs-communication` | `technical-docs` | Technical documentation standards |
| `engineering` | `test-author` | Create or update targeted tests using project-native conventions and validation |
| `engineering` | `thermo-nuclear-code-quality-review` | Strict maintainability review for abstraction quality, giant files, spaghetti-condition growth, and code-judo restructuring |
| `engineering` | `thermo-nuclear-review` | Comprehensive security and correctness audit of branch changes |
| `engineering` | `thermos` | Launch both thermo-nuclear review subagents in parallel |
| `developer-workflow` | `whats-new` | Git changelog generation between branches |
| `media` | `youtube-video-context` | YouTube transcript, summary, and video context extraction via summarize CLI with Codex and local Whisper fallback |

**Pi-only skills** (1, committed to this repo):

| Skill | Description |
|-------|-------------|
| `exa-search` | Semantic web search via Exa API |

**Package-provided skills** (7, installed via Pi packages):

Installed automatically when these packages are present in
`manifest.json`.

| Skill | Source |
|-------|--------|
| `design-deck` | [`npm:pi-design-deck`](https://github.com/nicobailon/pi-design-deck) |
| `ponytail` | [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |
| `ponytail-review` | [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |
| `ponytail-audit` | [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |
| `ponytail-debt` | [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |
| `ponytail-gain` | [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |
| `ponytail-help` | [`git:github.com/DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |

**External skills** (33, installed from source repos):

Listed in `manifest.json` and installed automatically by `setup.mjs`.
Not committed to this repo. Maintained by their original authors.

| Skill | Source |
|-------|--------|
| `docx`, `pdf`, `pptx`, `xlsx`, `frontend-design`, `skill-creator` | [anthropics/skills](https://github.com/anthropics/skills) |
| `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) |
| `vercel-composition-patterns`, `deploy-to-vercel`, `vercel-react-best-practices`, `vercel-react-native-skills`, `vercel-react-view-transitions`, `vercel-cli-with-tokens`, `vercel-optimize`, `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `learn-codebase`, `self-improve` | [HazAT/pi-config](https://github.com/HazAT/pi-config) |
| `vue-best-practices` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) |
| `autofix`, `code-review` | [coderabbitai/skills](https://github.com/coderabbitai/skills) |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) |
| `firecrawl` | [firecrawl/cli](https://github.com/firecrawl/cli) |
| `excalidraw-diagram` | [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) |
| `browser` | [browser-use/browser-harness](https://github.com/browser-use/browser-harness) |
| `agent-browser` | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) |
| `commit-context`, `commit-history`, `forget`, `handoff`, `recall`, `recap`, `remember`, `session-history` | [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) |

### Custom sub-agent roles (2)

Custom sub-agent roles live in `dotfiles/agents/` and are installed to
`~/.pi/agent/agents/`. These are user-managed role prompts consumed by
`@danchamorro/pi-subagents`; they are not bundled into the npm package.

| Role | Description |
|------|-------------|
| `thermo-nuclear-review-subagent` | Thermo-nuclear branch audit for bugs, breaking changes, security, devex regressions, and feature-flag leaks |
| `thermo-nuclear-code-quality-review-subagent` | Thermo-nuclear code quality audit for maintainability, structure, 1k-line rule, spaghetti, and code-judo review |

### Prompt templates (1)

Prompt templates live in `dotfiles/prompts/` and are installed to
`~/.pi/agent/prompts/` by `setup.mjs`.

| Prompt | Description |
|--------|-------------|
| `implementation-plan` | Convert an existing plan into actionable, committable checklist phases and write the result to a new Markdown file. |

### Themes (1)

Themes live in `dotfiles/themes/` and are installed to
`~/.pi/agent/themes/` by `setup.mjs`. They are available but not active by
default; pick one via `/settings` or set `"theme"` in your local
`~/.pi/agent/settings.json` (outside this repo, so it never affects other users).

| Theme | Description |
|-------|-------------|
| `vscode-dark-modern` | Pi port of VS Code's Dark Modern palette. Pure black base, near-black tool surfaces, VS Code Dark+ syntax colors, and diffs.com-inspired diff colors. |

### Config files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, code style, path discipline |
| `APPEND_SYSTEM.md` | System prompt: reasoning quality, jCodeMunch policies, documentation lookup, writing style |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction. Live-only at `~/.pi/agent/`; mutated by Pi at runtime and gitignored (not shipped in this repo). |
| `models.json` | Custom provider definitions, including local Ollama, vLLM, and llama.cpp models |
| `agent-modes.json` | Per-mode model/thinking overrides for debug, review, etc. |
| `damage-control-rules.yaml` | Safety rules: bash patterns, path access, delete protection |
| `auth.json.template` | Template for `auth.json` (provider API keys). Setup copies to live `~/.pi/agent/auth.json` on first run; never committed. |
| `mcp.json.template` | Template for `mcp.json` (MCP server configuration). Setup copies to live `~/.pi/agent/mcp.json` on first run; never committed. |

### MCP servers

Configured in `mcp.json` (created from template during setup):

| Server | Purpose | Source |
|--------|---------|--------|
| [jCodeMunch](https://github.com/jgravelle/jcodemunch-mcp) | Code indexing, symbol search, context-aware edit prep | `uvx jcodemunch-mcp` |
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Graph-backed architecture, call tracing, Cypher-style code queries | `codebase-memory-mcp` |
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only PostgreSQL access via Docker | `crystaldba/postgres-mcp` |
| [MariaDB MCP](https://github.com/MariaDB/mcp) | Read-only MariaDB or MySQL access via `uvx` | `uvx --from iflow-mcp_mariadb-mariadb-server mariadb-server` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol | `npx chrome-devtools-mcp@latest` |
| [Tirith](https://tirith.sh/) | Local security checks for commands, URLs, pasted content, files, directories, and MCP configs | `tirith mcp-server` |

---

## How to add new components

### Extensions, agents, skills, prompts, and themes

Start in the repo whenever possible. Choose the owner path first, then link
it into the live agent directories:

| Component | Repo-owned source | Installed or linked to | Notes |
|---|---|---|---|
| Extension | `dotfiles/extensions/*.ts` or `dotfiles/extensions/<name>/` | `~/.pi/agent/extensions/` | Add the required top-level JSDoc block and update `dotfiles/extensions/CHANGELOG.md`. |
| Custom sub-agent role | `dotfiles/agents/<role>.md` | `~/.pi/agent/agents/<role>.md` | Use for user-managed role prompts discovered by `@danchamorro/pi-subagents`. |
| Pi-only skill | `dotfiles/agent-skills/<skill>/` | `~/.pi/agent/skills/<skill>/` | Use for workflows that depend on Pi-only tools or UI. |
| Personal skill | `dotfiles/personal-skills/<category>/<skill>/` | `~/.agents/skills/<category>/<skill>/` and `~/.claude/skills/<skill>/` | Use for skills shared by Pi and Claude Code. These are not installed into `~/.pi/agent/skills/`. |
| Prompt template | `dotfiles/prompts/<prompt>.md` | `~/.pi/agent/prompts/` | Keep reusable prompts here instead of scattering local copies. |
| Theme | `dotfiles/themes/<theme>.json` | `~/.pi/agent/themes/` | Available after sync, but not automatically activated. |

After adding the file:

1. Run `npm run dev:sync` during development, or `npm run setup` for copy mode.
2. Reload Pi if the running agent does not pick up the new file. Reload Claude Code only for personal skill changes.
3. Run the narrow validation for the changed area.
4. Commit and push the repo changes.

If you already built the component outside the repo:

- In `~/.pi/agent/extensions`, `skills`, `agents`, `prompts`, or `themes`, run
  `node setup.mjs sync` and accept the items you want to absorb. The script
  moves them into `dotfiles/` and symlinks the live files back to the repo.
- In `~/.agents/skills` or `~/.claude/skills`, move the skill manually into
  `dotfiles/personal-skills/<category>/<skill>/`, then run
  `npm run dev:sync`. `setup.mjs sync` intentionally does not scan those
  directories.
- In a separate checkout or scratch directory, copy the source into the
  matching repo-owned path above, then run `npm run dev:sync`.
- If the work is an installable first-party Pi package, keep the source under
  `packages/<package>/`, publish it through the package workflow, and track the
  installed package name in `manifest.json`.

### External skills

1. Install: `npx skills add someone/repo -s skill-name -g -y`
2. Add an entry to `manifest.json`.
3. Run `npm run update:skills` later to refresh all tracked external
   skills from the manifest.

### Pi packages

1. Install: `pi install npm:package-name`
2. Add it to `manifest.json` under `packages`.
3. Update the README if it changes the documented setup.
4. Run `npm run update:packages` later to refresh all tracked Pi packages
   from the manifest.

---

## Attribution

Some of these tools and extensions were adopted from other creators and
modified to suit my needs:

- [Anthropic](https://www.anthropic.com)
- [Vercel](https://vercel.com)
- [HazAT](https://github.com/HazAT)
- [Matt Pocock](https://github.com/mattpocock)
- [Armin Ronacher (mitsuhiko)](https://github.com/mitsuhiko)
- [Disler](https://github.com/disler)
- [Jesse Vincent (obra)](https://github.com/obra)
- [Cursor Thermos](https://github.com/cursor/plugins/tree/main/thermos)
- [Nico Bailon](https://github.com/nicobailon)
- [thananon/9arm-skills](https://github.com/thananon/9arm-skills)
- [pawel-cell/micky-podcast-agentic-engineering](https://github.com/pawel-cell/micky-podcast-agentic-engineering)
- [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions)

## License

MIT

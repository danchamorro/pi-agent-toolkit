# pi-agent-toolkit

Extensions, skills, and configs for the
[Pi](https://github.com/badlogic/pi-mono) coding agent. My versioned
backup so I can restore or sync my setup across machines, and a reference
for anyone looking to customize their own Pi environment.

Includes 24 extensions, 36 skills, 2 prompt templates, 7 installable Pi
packages, MCP server configurations, and safety guardrails.

---

## Quick start

### For users (copy mode)

Clone and run:

```bash
git clone https://github.com/danchamorro/pi-agent-toolkit.git
cd pi-agent-toolkit
node setup.mjs
```

This copies everything into the right Pi directories. Template configs
(`auth.json`, `mcp.json`) are created only if they don't already exist.

Skip external skills or packages if you don't want them:

```bash
node setup.mjs --skip-external --skip-packages
```

### For development (link mode)

Symlink files so edits in the repo are immediately visible to Pi:

```bash
node setup.mjs --link
```

Re-run any time to pick up new files or clean dangling symlinks. Template
configs with secrets are never symlinked.

### Syncing local changes back

Built an extension or skill directly in `~/.pi/agent/`? Pull it into the
repo:

```bash
node setup.mjs sync
```

This finds unmanaged files (not symlinks, not external skills), offers to
move them into `dotfiles/`, and replaces the original with a symlink.
Use `--all` to skip the interactive prompts.

### Full usage

```
node setup.mjs                    Copy mode (for users / new machines)
node setup.mjs --link             Symlink mode (for development)
node setup.mjs sync               Absorb local Pi files into the repo
node setup.mjs sync --all         Absorb all without prompting
node setup.mjs --help             Show help

Flags (copy and link modes):
  --skip-external                 Skip installing external skills
  --skip-packages                 Skip installing Pi packages
```

---

## What's in this repo

### Packages (installable via pi)

This setup installs seven Pi packages via `manifest.json`:

```bash
pi install npm:@danchamorro/pi-agent-modes
pi install npm:@danchamorro/pi-prompt-enhancer
pi install npm:pi-design-deck
pi install npm:pi-annotate
pi install npm:pi-subagents
pi install npm:pi-intercom
pi install git:https://github.com/badlogic/pi-diff-review
```

**Published from this repo:**

| Package | Description | npm |
|---|---|---|
| [agent-modes](packages/agent-modes) | Switch between code, architect, debug, ask, and review modes with enforced tool restrictions, bash allowlists, and per-mode model assignment | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-agent-modes)](https://www.npmjs.com/package/@danchamorro/pi-agent-modes) |
| [prompt-enhancer](packages/prompt-enhancer) | Rewrite prompts to be clearer and more actionable before sending | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-prompt-enhancer)](https://www.npmjs.com/package/@danchamorro/pi-prompt-enhancer) |

**Also installed as part of this setup:**

| Package | Description | Source |
|---|---|---|
| `pi-design-deck` | Present multi-slide visual decision decks with high-fidelity previews. Bundles the `design-deck` skill used in this setup. | [nicobailon/pi-design-deck](https://github.com/nicobailon/pi-design-deck) |
| `pi-annotate` | Visual browser annotation for AI-assisted UI debugging. Adds `/annotate` plus companion Chrome extension tooling. | [nicobailon/pi-annotate](https://github.com/nicobailon/pi-annotate) |
| `pi-subagents` | Delegate work to subagents with single, chain, and parallel execution modes. Ships built-in agent definitions like `scout`, `planner`, `worker`, and `reviewer`. | [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) |
| `pi-intercom` | Direct 1:1 messaging between Pi sessions on the same machine, with an `intercom` tool plus `/intercom` and `Alt+M` UI entry points. | [nicobailon/pi-intercom](https://github.com/nicobailon/pi-intercom) |
| `pi-diff-review` | Native diff review window for Pi. Adds a `/diff-review` command that opens changed files in a Monaco diff editor and turns review notes into a prompt back in Pi. | [badlogic/pi-diff-review](https://github.com/badlogic/pi-diff-review) |

### Extensions (24)

All extensions live in `dotfiles/extensions/`. See
[dotfiles/extensions/README.md](dotfiles/extensions/README.md) for the
full list with descriptions.

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
| `uv.ts` | Intercepts pip/python calls and redirects to uv |

### Skills

**Bundled skills** (11, committed to this repo):

| Skill | Description |
|-------|-------------|
| `1password-developer` | 1Password SSH agent, Environments, and op CLI workflows |
| `brainstorm` | Interview-driven plan stress-testing |
| `cli-detector` | Scan repos for service integrations and their CLIs |
| `code-review` | AI-powered code review using CodeRabbit CLI |
| `exa-search` | Semantic web search via Exa API |
| `gh-issue-creator` | Create GitHub issues via `gh` CLI |
| `google-chat-cards-v2` | Google Chat Cards v2 notifications |
| `nushell-shell` | Interactive Nushell usage, shell one-liner translation to Nu, and choosing Nu vs traditional shells |
| `plan-reviewer` | Review implementation plans for evidence, trackability, dependencies, risks, and validation before execution |
| `technical-docs` | Technical documentation standards |
| `whats-new` | Git changelog generation between branches |

**Package-provided skills** (2, installed via Pi packages):

Installed automatically when these packages are present in
`manifest.json`.

| Skill | Source |
|-------|--------|
| `design-deck` | [`npm:pi-design-deck`](https://github.com/nicobailon/pi-design-deck) |

**External skills** (26, installed from source repos):

Listed in `manifest.json` and installed automatically by `setup.mjs`.
Not committed to this repo. Maintained by their original authors.

| Skill | Source |
|-------|--------|
| `docx`, `pdf`, `pptx`, `xlsx`, `frontend-design`, `skill-creator`, `agent-browser` | [anthropics/skills](https://github.com/anthropics/skills) |
| `vercel-react-best-practices`, `web-design-guidelines`, `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) |
| `learn-codebase`, `self-improve` | [HazAT/pi-config](https://github.com/HazAT/pi-config) |
| `cmux`, `cmux-and-worktrees`, `cmux-browser`, `cmux-debug-windows`, `cmux-markdown` | [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) |
| `vue-best-practices` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) |
| `nushell-pro` | [hustcer/nushell-pro](https://github.com/hustcer/nushell-pro) |
| `systematic-debugging`, `writing-skills` | [obra/superpowers](https://github.com/obra/superpowers) |
| `code-simplifier`, `iterate-pr` | [getsentry/skills](https://github.com/getsentry/skills) |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) |
| `firecrawl` | [firecrawl/cli](https://github.com/firecrawl/cli) |
| `excalidraw-diagram` | [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) |

### Subagents

Custom subagents live in `dotfiles/agents/` and are installed to
`~/.pi/agent/agents/` by `setup.mjs`.

| Agent | Description |
|-------|-------------|
| `db-researcher` | Read-only database investigation agent for MCP-connected databases. It has `mcp` access, no edit/write tools, and explicit safety rules against mutations, DDL, migrations, backfills, or large exports. |

### Prompt templates (2)

Prompt templates live in `dotfiles/prompts/` and are installed to
`~/.pi/agent/prompts/` by `setup.mjs`.

| Prompt | Description |
|--------|-------------|
| `implementation-plan` | Convert an existing plan into actionable, committable checklist phases and write the result to a new Markdown file. |
| `orchestrate` | Orchestrate a task using `pi-subagents` and `intercom`, keeping planning and final synthesis in the current session while delegating focused work to subagents. |

### Config files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, code style, path discipline |
| `APPEND_SYSTEM.md` | System prompt: reasoning quality, jCodeMunch policies, documentation lookup, writing style |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction. Mutated by Pi at runtime; gitignored. |
| `models.json` | Custom provider definitions (e.g., local models via Ollama) |
| `agent-modes.json` | Per-mode model/thinking overrides for debug, review, etc. |
| `damage-control-rules.yaml` | Safety rules: bash patterns, path access, delete protection |
| `auth.json` | Provider API keys (created from template, never committed) |
| `mcp.json` | MCP server configuration (created from template, never committed) |

### MCP servers

Configured in `mcp.json` (created from template during setup):

| Server | Purpose | Source |
|--------|---------|--------|
| [jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) | Code indexing, symbol search, context-aware exploration | `uvx jcodemunch-mcp@latest` |
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only PostgreSQL access via Docker | `crystaldba/postgres-mcp` |
| [MariaDB MCP](https://github.com/MariaDB/mcp) | Read-only MariaDB or MySQL access via `uvx` | `uvx --from iflow-mcp_mariadb-mariadb-server mariadb-server` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol | `npx chrome-devtools-mcp@latest` |

---

## How to add new components

### Extensions, skills, prompts, agents, and themes

1. Create the file in `dotfiles/extensions/`, `dotfiles/agent-skills/`,
   `dotfiles/global-skills/`, `dotfiles/prompts/`, `dotfiles/agents/`,
   or `dotfiles/themes/`.
2. If using `--link` mode, it's already live. Otherwise re-run `setup.mjs`.
3. Commit and push.

Or build locally in Pi, then absorb with `node setup.mjs sync`.

### External skills

1. Install: `npx skills add someone/repo -s skill-name -g -y`
2. Add an entry to `manifest.json`.

### Pi packages

1. Install: `pi install npm:package-name`
2. Add it to `manifest.json` under `packages`.
3. Update the README if it changes the documented setup.

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
- [Nico Bailon](https://github.com/nicobailon)

## License

MIT

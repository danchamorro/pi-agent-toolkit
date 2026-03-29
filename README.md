# pi-toolkit

My personal [Pi](https://github.com/badlogic/pi-mono) coding agent setup,
combined with Pi packages I've built. This repo serves two purposes: it's
my versioned backup so I can restore or sync my setup across machines, and
it's a reference for anyone looking to customize their own Pi environment.

Includes installable npm packages, 22 extensions, 30 skills, MCP server
configurations, and safety guardrails. Use all of it, fork it as a
starting point, or cherry-pick the pieces you want.

---

## What's in this repo

### Packages (installable via pi)

Standalone packages you can install without cloning the repo:

```bash
pi install npm:@danchamorro/pi-agent-modes
pi install npm:@danchamorro/pi-prompt-enhancer
```

| Package | Description | npm |
|---|---|---|
| [agent-modes](packages/agent-modes) | Switch between code, architect, debug, ask, and review modes with enforced tool restrictions, bash allowlists, and per-mode model assignment | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-agent-modes)](https://www.npmjs.com/package/@danchamorro/pi-agent-modes) |
| [prompt-enhancer](packages/prompt-enhancer) | Rewrite prompts to be clearer and more actionable before sending | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-prompt-enhancer)](https://www.npmjs.com/package/@danchamorro/pi-prompt-enhancer) |

### Extensions (22 total)

All extensions live in `dotfiles/extensions/` and are symlinked into
`~/.pi/agent/extensions/` by the installer.

**Safety and workflow:**

| Extension | What it does |
|-----------|-------------|
| `damage-control/` | Safety guardrail engine: blocks destructive commands, enforces path access rules, prevents accidental deletes |
| `commit-approval.ts` | Intercepts git commits for interactive review before execution |
| `pr-approval.ts` | Intercepts PR creation for interactive review |
| `dirty-repo-guard.ts` | Warns when working in a repo with uncommitted changes |

**Search and tools:**

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
| `files.ts` | File picker with quick actions (reveal, open, edit, diff) |
| `review.ts` | Code review: PR review, branch diffs, uncommitted changes |
| `session-breakdown.ts` | Session cost/usage analytics with calendar heatmap |
| `todos.ts` | File-based todo management |
| `term-notify.ts` | Desktop notifications on agent completion (cmux + OSC 777) |
| `qna-interactive.ts` | Structured Q&A mode |
| `question-mode.ts` | Read-only question mode (no file changes) |
| `require-session-name-on-exit.ts` | Prompts for session name before exit |
| `execute-command/` | Slash command execution |
| `uv.ts` | Intercepts pip/python calls and redirects to uv |

### MCP Servers

Configured in `mcp.json` (created from template during install). These
are the MCP servers this setup uses:

| Server | Purpose | Source |
|--------|---------|--------|
| [jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) | Code indexing, symbol search, context-aware exploration. Auto-indexes repos on session start. | `uvx jcodemunch-mcp@latest` |
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only database access via Docker. Runs with `--access-mode=restricted` and `lazy` lifecycle. | `crystaldba/postgres-mcp` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol. | `npx chrome-devtools-mcp@latest` |
| [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) | Improves MCP tool response display in Pi (collapsible output). Installed as a pi package, not an MCP server. | `pi install npm:pi-mcp-adapter` |

See [dotfiles/SETUP.md](dotfiles/SETUP.md) for configuration details and
safety patterns.

### Skills

**My skills** (7, bundled in this repo):

| Skill | Description |
|-------|-------------|
| `brainstorm` | Interview-driven plan stress-testing |
| `cli-detector` | Scan repos for service integrations and their CLIs |
| `exa-search` | Semantic web search via Exa API |
| `gh-issue-creator` | Create GitHub issues via `gh` CLI |
| `google-chat-cards-v2` | Google Chat Cards v2 notifications |
| `technical-docs` | Technical documentation standards |
| `whats-new` | Git changelog generation between branches |

**External skills** (23, installed from source repos via
[skills CLI](https://github.com/vercel-labs/skills)):

Maintained by their original authors. Installed automatically by
`install.sh`, not committed to this repo.

| Skill | Source |
|-------|--------|
| `docx`, `pdf`, `pptx`, `xlsx`, `frontend-design`, `skill-creator`, `agent-browser` | [anthropics/skills](https://github.com/anthropics/skills) |
| `vercel-react-best-practices`, `web-design-guidelines`, `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) |
| `learn-codebase`, `self-improve` | [HazAT/pi-config](https://github.com/HazAT/pi-config) |
| `cmux`, `cmux-and-worktrees`, `cmux-browser` | [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) |
| `vue-best-practices` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) |
| `systematic-debugging`, `writing-skills` | [obra/superpowers](https://github.com/obra/superpowers) |
| `code-simplifier`, `iterate-pr` | [getsentry/skills](https://github.com/getsentry/skills) |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) |
| `firecrawl` | [firecrawl/cli](https://github.com/firecrawl/cli) |
| `excalidraw-diagram` | [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) |

### Config Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, code style, path discipline |
| `APPEND_SYSTEM.md` | System prompt: reasoning quality, jCodeMunch policy, documentation lookup, writing style |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction |
| `models.json` | Custom provider definitions (e.g., local MLX models) |
| `agent-modes.json` | Per-mode model/thinking overrides for debug, review, etc. |
| `damage-control-rules.yaml` | Safety rules: bash patterns, path access, delete protection |

---

## How to use this

### Option 1: Just the packages

Install packages directly without cloning:

```bash
pi install npm:@danchamorro/pi-agent-modes
pi install npm:@danchamorro/pi-prompt-enhancer
```

### Option 2: Full setup

Clone and run the installer to get everything (extensions, skills, configs,
MCP templates, safety guardrails):

```bash
git clone https://github.com/danchamorro/pi-toolkit.git
cd pi-toolkit/dotfiles
./install.sh
```

The installer:

1. Symlinks extensions, configs, and bundled skills
2. Installs 23 external skills via `npx skills add`
3. Creates `auth.json` and `mcp.json` from templates (fill in your keys)
4. Runs `npm install` for extensions with dependencies
5. Installs the two npm packages

To update after a pull: `./install.sh --update`

If you fork this repo as your own setup, use `./install.sh --sync` to
absorb new extensions or skills you built in pi back into the repo.

See [dotfiles/SETUP.md](dotfiles/SETUP.md) for the full walkthrough.

### Option 3: Cherry-pick

Browse [`dotfiles/`](dotfiles/) and grab what you want:

- Copy individual `.ts` extension files into `~/.pi/agent/extensions/`
- Copy skill directories into `~/.pi/agent/skills/` or `~/.agents/skills/`
- Use the external skill install commands from
  [dotfiles/README.md](dotfiles/README.md)
- Read the config files for patterns to adapt to your own setup

See [dotfiles/README.md](dotfiles/README.md) for descriptions of every file.

---

## Attribution

Some of these tools and extensions were adopted from other creators and
modified to suit my needs. Below is an attribution list:

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

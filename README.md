# pi-agent-toolkit

A CLI to selectively install curated extensions, skills, and configs for
the [Pi](https://github.com/badlogic/pi-mono) coding agent. Pick and
choose what you want, or install everything at once.

Includes 22 extensions, 31 skills, 2 installable npm packages, MCP server
configurations, and safety guardrails.

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

All extensions live in `dotfiles/extensions/` and are copied into
`~/.pi/agent/extensions/` by the installer. Developers can use
`--link --repo-path` to symlink them instead, so edits to the repo
are reflected immediately.

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

[pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) is not an
MCP server. It is a Pi package that improves how MCP tool responses are
displayed (collapsible output for large results). Install with
`pi install npm:pi-mcp-adapter`.

See [dotfiles/SETUP.md](dotfiles/SETUP.md) for configuration details and
safety patterns.

### Skills

**My skills** (8, bundled in this repo):

| Skill | Description |
|-------|-------------|
| `brainstorm` | Interview-driven plan stress-testing |
| `cli-detector` | Scan repos for service integrations and their CLIs |
| `code-review` | AI-powered code review using CodeRabbit CLI |
| `exa-search` | Semantic web search via Exa API |
| `gh-issue-creator` | Create GitHub issues via `gh` CLI |
| `google-chat-cards-v2` | Google Chat Cards v2 notifications |
| `technical-docs` | Technical documentation standards |
| `whats-new` | Git changelog generation between branches |

**External skills** (23, installed from source repos via
[skills CLI](https://github.com/vercel-labs/skills)):

Maintained by their original authors. Installed automatically by
`pi-agent-toolkit install`, not committed to this repo.

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
| `auth.json` | Provider API keys, created from template during install |
| `mcp.json` | MCP server configuration, created from template during install |

---

## Quick start

Run once with `npx`, or install the CLI globally:

```bash
npx pi-agent-toolkit install
npm install -g pi-agent-toolkit
```

Interactive picker (choose what you want):

```bash
pi-agent-toolkit install
```

Install everything:

```bash
pi-agent-toolkit install --all
```

Install specific components:

```bash
pi-agent-toolkit install --extensions "damage-control commit-approval exa-search-tool"
pi-agent-toolkit install --skills "brainstorm systematic-debugging"
pi-agent-toolkit install --packages "agent-modes prompt-enhancer"
```

Browse the full catalog:

```bash
pi-agent-toolkit list
```

Check what's installed:

```bash
pi-agent-toolkit status
```

Update the CLI to the latest version:

```bash
pi-agent-toolkit update
```

### For contributors / personal setup

Clone the repo and symlink so edits flow back:

```bash
git clone https://github.com/danchamorro/pi-agent-toolkit.git
cd pi-agent-toolkit
pi-agent-toolkit install --all --override-configs --link --repo-path .
```

Template configs such as `auth.json` and `mcp.json` are still copied, not
symlinked, so machine-specific secrets stay local.

To absorb unmanaged extensions, skills, prompts, agents, or themes back
into the repo:

```bash
pi-agent-toolkit sync --repo-path .
```

See [dotfiles/SETUP.md](dotfiles/SETUP.md) for detailed configuration.

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

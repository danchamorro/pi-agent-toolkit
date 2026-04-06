# pi-agent-toolkit

Extensions, skills, and configs for the
[Pi](https://github.com/badlogic/pi-mono) coding agent. My versioned
backup so I can restore or sync my setup across machines, and a reference
for anyone looking to customize their own Pi environment.

Includes 24 extensions, 34 skills, 2 installable npm packages, MCP server
configurations, and safety guardrails.

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

Standalone packages you can install without cloning the repo:

```bash
pi install npm:@danchamorro/pi-agent-modes
pi install npm:@danchamorro/pi-prompt-enhancer
```

| Package | Description | npm |
|---|---|---|
| [agent-modes](packages/agent-modes) | Switch between code, architect, debug, ask, and review modes with enforced tool restrictions, bash allowlists, and per-mode model assignment | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-agent-modes)](https://www.npmjs.com/package/@danchamorro/pi-agent-modes) |
| [prompt-enhancer](packages/prompt-enhancer) | Rewrite prompts to be clearer and more actionable before sending | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-prompt-enhancer)](https://www.npmjs.com/package/@danchamorro/pi-prompt-enhancer) |

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
| `coach.ts` | Recommends underused Pi workflows based on session habits |
| `files.ts` | File picker with quick actions (reveal, open, edit, diff) |
| `review.ts` | Code review: PR review, branch diffs, uncommitted changes |
| `session-breakdown.ts` | Session cost/usage analytics with calendar heatmap |
| `find-session.ts` | Search past Pi sessions with LLM ranking and one-step resume |
| `todos.ts` | File-based todo management |
| `term-notify.ts` | Desktop notifications on agent completion (cmux + OSC 777) |
| `qna-interactive.ts` | Structured Q&A mode |
| `question-mode.ts` | Read-only question mode (no file changes) |
| `require-session-name-on-exit.ts` | Prompts for session name before exit |
| `clean-sessions.ts` | Prunes old, low-value session files |
| `uv.ts` | Intercepts pip/python calls and redirects to uv |

### Skills

**Bundled skills** (9, committed to this repo):

| Skill | Description |
|-------|-------------|
| `1password-developer` | 1Password SSH agent, Environments, and op CLI workflows |
| `brainstorm` | Interview-driven plan stress-testing |
| `cli-detector` | Scan repos for service integrations and their CLIs |
| `code-review` | AI-powered code review using CodeRabbit CLI |
| `exa-search` | Semantic web search via Exa API |
| `gh-issue-creator` | Create GitHub issues via `gh` CLI |
| `google-chat-cards-v2` | Google Chat Cards v2 notifications |
| `technical-docs` | Technical documentation standards |
| `whats-new` | Git changelog generation between branches |

**External skills** (25, installed from source repos):

Listed in `manifest.json` and installed automatically by `setup.mjs`.
Not committed to this repo. Maintained by their original authors.

| Skill | Source |
|-------|--------|
| `docx`, `pdf`, `pptx`, `xlsx`, `frontend-design`, `skill-creator`, `agent-browser` | [anthropics/skills](https://github.com/anthropics/skills) |
| `vercel-react-best-practices`, `web-design-guidelines`, `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) |
| `learn-codebase`, `self-improve` | [HazAT/pi-config](https://github.com/HazAT/pi-config) |
| `cmux`, `cmux-and-worktrees`, `cmux-browser`, `cmux-debug-windows`, `cmux-markdown` | [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) |
| `vue-best-practices` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) |
| `systematic-debugging`, `writing-skills` | [obra/superpowers](https://github.com/obra/superpowers) |
| `code-simplifier`, `iterate-pr` | [getsentry/skills](https://github.com/getsentry/skills) |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) |
| `firecrawl` | [firecrawl/cli](https://github.com/firecrawl/cli) |
| `excalidraw-diagram` | [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) |

### Config files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, code style, path discipline |
| `APPEND_SYSTEM.md` | System prompt: reasoning quality, jCodeMunch policy, documentation lookup, writing style |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction |
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
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only database access via Docker | `crystaldba/postgres-mcp` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol | `npx chrome-devtools-mcp@latest` |

---

## How to add new components

### Extensions and skills

1. Create the file in `dotfiles/extensions/`, `dotfiles/agent-skills/`, or
   `dotfiles/global-skills/`.
2. If using `--link` mode, it's already live. Otherwise re-run `setup.mjs`.
3. Commit and push.

Or build locally in Pi, then absorb with `node setup.mjs sync`.

### External skills

1. Install: `npx skills add someone/repo -s skill-name -g -y`
2. Add an entry to `manifest.json`.

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

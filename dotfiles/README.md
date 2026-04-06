# pi-agent-toolkit dotfiles

Pi coding agent configuration: extensions, skills, config files, and
safety guardrails. Everything in this directory is managed by `setup.mjs`
at the repo root.

## Directory layout

```
dotfiles/
  extensions/ ............. 24 extensions (.ts files and subdirectories)
  agent-skills/ ........... Pi-scoped skills    (-> ~/.pi/agent/skills/)
  global-skills/ .......... Cross-agent skills   (-> ~/.agents/skills/)
  intercepted-commands/ ... Python/pip shims (uv.ts dependency)
  prompts/ ................ Prompt templates     (-> ~/.pi/agent/prompts/)
  agents/ ................. Agent configs        (-> ~/.pi/agent/agents/)
  themes/ ................. TUI themes           (-> ~/.pi/agent/themes/)
  Config files ............ AGENTS.md, APPEND_SYSTEM.md, settings.json, etc.
```

## Config files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, PR style, code style, path discipline, cmux integration |
| `APPEND_SYSTEM.md` | System prompt additions: reasoning quality, jCodeMunch policy, documentation lookup, writing style |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction, installed packages |
| `models.json` | Custom model/provider definitions (e.g., local models via Ollama) |
| `agent-modes.json` | Per-mode overrides: which provider/model/thinking level to use in debug, review, etc. |
| `damage-control-rules.yaml` | Safety guardrails (see section below) |
| `auth.json.template` | Template for `auth.json` (provider API keys, created on first run) |
| `mcp.json.template` | Template for `mcp.json` (MCP server configuration, created on first run) |

## Extensions

### Internalized from mitsuhiko/agent-stuff

Forked from commit `3bf6bd3` of [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff).
All 9 extensions are self-contained in this repo (no upstream package reference).

| Extension | Origin | Notes |
|-----------|--------|-------|
| `btw.ts` | Forked | Fixed `getApiKey` -> `getApiKeyAndHeaders`. Added scroll support. |
| `control.ts` | Forked | Fixed `getApiKey` calls in summarization and RPC handler. |
| `loop.ts` | Forked | Fixed `getApiKey` calls in summary model and breakout condition. |
| `context.ts` | Ported | Context management from upstream. |
| `files.ts` | Ported | File operation tools from upstream. |
| `review.ts` | Ported | Code review extension from upstream. |
| `session-breakdown.ts` | Ported | Session cost/usage breakdown from upstream. |
| `todos.ts` | Ported | File-based todo management from upstream. |
| `uv.ts` | Ported | Python/uv integration. Depends on `intercepted-commands/`. |

### Original extensions

| Extension | Purpose |
|-----------|---------|
| `term-notify.ts` | Desktop notification on agent completion (cmux + OSC 777 fallback) |
| `commit-approval.ts` | Interactive commit approval workflow |
| `pr-approval.ts` | Interactive PR approval workflow |
| `dirty-repo-guard.ts` | Warns when working in a repo with uncommitted changes |
| `exa-enforce.ts` | Enforces Exa usage for web search |
| `exa-search-tool.ts` | Registers Exa as a search tool |
| `qna-interactive.ts` | Interactive Q&A mode |
| `question-mode.ts` | Question-only mode (no file changes) |
| `require-session-name-on-exit.ts` | Prompts for a session name before exiting |
| `clean-sessions.ts` | Prunes old, low-value session files |
| `find-session.ts` | Search past Pi sessions with LLM ranking and one-step resume |
| `coach.ts` | Recommends underused Pi workflows based on session habits |
| `tilldone.ts` | Task list management with progress tracking |
| `tools.ts` | Custom tool registrations |

### Directory-based extensions

| Extension | Purpose |
|-----------|---------|
| `damage-control/` | Safety guardrail engine. Loads `damage-control-rules.yaml` and enforces bash command patterns, path access rules, and delete protections. Has its own `package.json` (deps installed automatically). |

## Safety guardrails (Damage Control)

The `damage-control/` extension + `damage-control-rules.yaml` form a
safety system that protects against destructive operations:

- **Bash command patterns**: Blocks or prompts for `rm -rf`, `sudo`,
  `git reset --hard`, `git push --force`, AWS/GCP/Firebase/Vercel
  destructive operations, and SQL `DROP`/`TRUNCATE`/`DELETE` without
  `WHERE`.
- **Read-only paths**: System directories, lock files, minified bundles,
  build output, `node_modules/`.
- **No-delete paths**: `.git/`, config files (`LICENSE`, `README.md`,
  `Dockerfile`, CI configs), `~/.pi/`, `~/.claude/`.
- **AWS S3 allowlist**: Only `ls` and `cp` are permitted; all other S3
  operations are blocked.

## MCP servers

Configured in `mcp.json` (created from `mcp.json.template` on first run):

| Server | Purpose | How it runs |
|--------|---------|-------------|
| [jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) | Code indexing, symbol search, context-aware code exploration. Auto-indexes on session start. | `uvx jcodemunch-mcp@latest` |
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only database access. Runs in Docker with `--access-mode=restricted`. Uses `"lifecycle": "lazy"`. | `docker run crystaldba/postgres-mcp` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol. | `npx chrome-devtools-mcp@latest` |

[pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) is not an
MCP server. It is a Pi extension that improves how MCP tool responses are
displayed (collapsible output for large results). Install with
`pi install npm:pi-mcp-adapter`.

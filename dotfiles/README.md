# pi-agent-toolkit dotfiles

Complete [Pi](https://github.com/badlogic/pi-mono) coding agent configuration:
extensions, skills, config files, and safety guardrails.

## What's in here

```
dotfiles/
  Config files ........ AGENTS.md, APPEND_SYSTEM.md, settings.json, etc.
  extensions/ ......... 20 single-file + 2 directory-based extensions
  intercepted-commands/ Python/pip shims (uv.ts dependency)
  agent-skills/ ....... Pi-specific skills  (-> ~/.pi/agent/skills/)
  global-skills/ ...... Agent-agnostic skills (-> ~/.agents/skills/)
```

Installation is handled by the `pi-agent-toolkit` CLI. See
[SETUP.md](SETUP.md) for the full walkthrough.

### CLI commands (replaced install.sh)

| Command | Purpose |
|---------|---------|
| `pi-agent-toolkit install` | Interactive picker or `--all` for everything |
| `pi-agent-toolkit install --all --override-configs --link --repo-path .` | Contributor setup with symlinks |
| `pi-agent-toolkit sync --repo-path .` | Absorb unmanaged extensions, skills, prompts, agents, and themes from `~/.pi/agent/`, plus global skills from `~/.agents/skills/`, into the repo (contributors only) |

---

## Config Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, PR style, code style, path discipline, cmux integration |
| `APPEND_SYSTEM.md` | System prompt additions: reasoning quality, jCodeMunch policy, documentation lookup rules, writing style, external data preferences |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction config, installed packages |
| `models.json` | Custom model/provider definitions (e.g., local MLX models via OpenAI-compatible API) |
| `agent-modes.json` | Per-mode overrides: which provider/model/thinking level to use in debug, review, etc. |
| `damage-control-rules.yaml` | Safety guardrails (see section below) |
| `auth.json.template` | Template for `auth.json`, which stores provider API keys after install |
| `mcp.json.template` | Template for `mcp.json`, which stores MCP server configuration after install |

---

## Extensions

### Internalized from mitsuhiko/agent-stuff

Forked from commit `3bf6bd3` of [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff).
All 9 extensions are now self-contained in this repo (no upstream package reference).

| Extension | Origin | Notes |
|-----------|--------|-------|
| `btw.ts` | Forked | Fixed `getApiKey` -> `getApiKeyAndHeaders`. Added scroll support (Shift+Up/Down, PgUp/PgDn). |
| `control.ts` | Forked | Fixed `getApiKey` calls in summarization model selection and `get_summary` RPC handler. |
| `loop.ts` | Forked | Fixed `getApiKey` calls in summary model, breakout condition, and `session_before_compact` handler. |
| `context.ts` | Ported | Context management from upstream. |
| `files.ts` | Ported | File operation tools from upstream. |
| `review.ts` | Ported | Code review extension from upstream. |
| `session-breakdown.ts` | Ported | Session cost/usage breakdown from upstream. |
| `todos.ts` | Ported | File-based todo management from upstream. |
| `uv.ts` | Ported | Python/uv integration. Depends on `intercepted-commands/`. |

**Excluded from upstream** (7 files not wanted or redundant): `go-to-bed.ts`,
`whimsical.ts`, `prompt-editor.ts`, `split-fork.ts`, `answer.ts`,
`multi-edit.ts`, `notify.ts`.

### Original extensions

| Extension | Purpose |
|-----------|---------|
| `term-notify.ts` | Desktop notification on agent completion. Uses `cmux notify` + flash when in cmux, falls back to OSC 777 for Ghostty/iTerm2/WezTerm. |
| `commit-approval.ts` | Interactive commit approval workflow. Intercepts git commits for review. |
| `pr-approval.ts` | Interactive PR approval workflow. Intercepts PR creation for review. |
| `dirty-repo-guard.ts` | Warns when working in a repo with uncommitted changes. |
| `exa-enforce.ts` | Enforces Exa usage for web search instead of ad-hoc methods. |
| `exa-search-tool.ts` | Registers Exa as a search tool for the agent. |
| `qna-interactive.ts` | Interactive Q&A mode with structured question/answer flow. |
| `question-mode.ts` | Question-only mode that restricts the agent to asking questions. |
| `require-session-name-on-exit.ts` | Prompts for a session name before exiting Pi. |
| `tilldone.ts` | Task list management with progress tracking. |
| `tools.ts` | Custom tool registrations. |

### Directory-based extensions

| Extension | Purpose |
|-----------|---------|
| `damage-control/` | Safety guardrail engine. Loads `damage-control-rules.yaml` and enforces bash command patterns, path access rules, and delete protections. Has its own `package.json` (runs `npm install`). |
| `execute-command/` | Slash command execution extension. |

---

## Safety Guardrails (Damage Control)

The `damage-control/` extension + `damage-control-rules.yaml` form a
comprehensive safety system that protects against destructive operations:

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

---

## MCP Servers

Configured in `mcp.json` (created from `mcp.json.template` during install).
See [SETUP.md](SETUP.md) for detailed configuration instructions.

| Server | Purpose | How it runs |
|--------|---------|-------------|
| [jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) | Code indexing, symbol search, context-aware code exploration. Automatically indexes the current repo on session start (configured in `APPEND_SYSTEM.md`). Incremental indexing keeps subsequent runs fast. | `uvx jcodemunch-mcp@latest` |
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only database access. Runs in Docker with `--access-mode=restricted` so only SELECT queries are allowed. Uses `"lifecycle": "lazy"` so the server only starts when first used. Add multiple entries for different databases. | `docker run crystaldba/postgres-mcp` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol. Connects to running Chrome instances for page interaction, screenshots, and debugging. | `npx chrome-devtools-mcp@latest` |

### pi-mcp-adapter

[pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) is not an
MCP server. It is a Pi extension that improves how MCP tool responses are
displayed in Pi (collapsible output for large results). Installed as a
Pi package:

```bash
pi install npm:pi-mcp-adapter
```

---

## Skills

### My skills (bundled in this repo)

Skills I built or heavily customized. Installed by the `pi-agent-toolkit` CLI.

| Skill | Description |
|-------|-------------|
| `brainstorm` | Interview-driven plan stress-testing |
| `cli-detector` | Scan repos for external service integrations and their CLIs |
| `code-review` | AI-powered code review using CodeRabbit CLI |
| `exa-search` | Semantic web search and structured research using Exa API |
| `gh-issue-creator` | Create GitHub issues via `gh` CLI |
| `google-chat-cards-v2` | Google Chat Cards v2 rich alert notifications |
| `technical-docs` | Technical documentation standards |
| `whats-new` | Git changelog generation between branches |

### External skills (installed from source repos)

These skills are maintained by their original authors and installed
by the `pi-agent-toolkit` CLI via the
[skills CLI](https://github.com/vercel-labs/skills). They are not committed
to this repo.

When you run `pi-agent-toolkit sync`, the command scans unmanaged items in
`~/.pi/agent/` and `~/.agents/skills/`, copies selected files into
`dotfiles/`, replaces the originals with symlinks, and then prints the next
steps for adding the new items to `packages/cli/src/lib/registry.ts`.

| Skill | Source | Install command |
|-------|--------|-----------------|
| `docx` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s docx -g -y` |
| `pdf` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s pdf -g -y` |
| `pptx` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s pptx -g -y` |
| `xlsx` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s xlsx -g -y` |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s frontend-design -g -y` |
| `skill-creator` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s skill-creator -g -y` |
| `agent-browser` | [anthropics/skills](https://github.com/anthropics/skills) | `npx skills add anthropics/skills -s agent-browser -g -y` |
| `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | `npx skills add vercel-labs/skills -s find-skills -g -y` |
| `vercel-react-best-practices` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | `npx skills add vercel-labs/skills -s vercel-react-best-practices -g -y` |
| `web-design-guidelines` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | `npx skills add vercel-labs/skills -s web-design-guidelines -g -y` |
| `learn-codebase` | [HazAT/pi-config](https://github.com/HazAT/pi-config) | `npx skills add HazAT/pi-config -s learn-codebase -g -y` |
| `self-improve` | [HazAT/pi-config](https://github.com/HazAT/pi-config) | `npx skills add HazAT/pi-config -s self-improve -g -y` |
| `cmux` | [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) | `npx skills add manaflow-ai/cmux -s cmux -g -y` |
| `cmux-and-worktrees` | [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) | `npx skills add manaflow-ai/cmux -s cmux-and-worktrees -g -y` |
| `cmux-browser` | [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) | `npx skills add manaflow-ai/cmux -s cmux-browser -g -y` |
| `vue-best-practices` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) | `npx skills add hyf0/vue-skills -s vue-best-practices -g -y` |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers) | `npx skills add obra/superpowers -s systematic-debugging -g -y` |
| `writing-skills` | [obra/superpowers](https://github.com/obra/superpowers) | `npx skills add obra/superpowers -s writing-skills -g -y` |
| `code-simplifier` | [getsentry/skills](https://github.com/getsentry/skills) | `npx skills add getsentry/skills -s code-simplifier -g -y` |
| `iterate-pr` | [getsentry/skills](https://github.com/getsentry/skills) | `npx skills add getsentry/skills -s iterate-pr -g -y` |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | `npx skills add microsoft/playwright-cli -g -y` |
| `firecrawl` | [firecrawl/cli](https://github.com/firecrawl/cli) | `npx skills add firecrawl/cli -s firecrawl -g -y` |
| `excalidraw-diagram` | [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) | `npx skills add coleam00/excalidraw-diagram-skill -g -y` |

You don't need to run these commands manually.
`pi-agent-toolkit install` handles all of them. The commands are listed
here for cherry-pickers who want individual skills without the full setup.

# pi-agent-toolkit dotfiles

Installable Pi and Claude Code configuration for my personal agent setup:
extensions, personal skills, Pi-only skills, config files, and safety
guardrails. `setup.mjs` installs the content in this directory into the
appropriate agent paths. External skills are tracked separately in
`manifest.json` and installed via `npx skills add`.

## Directory layout

```
dotfiles/
  extensions/ ............. 26 extensions (.ts files and subdirectories)
  agent-skills/ ........... Pi-only skills        (-> ~/.pi/agent/skills/)
  personal-skills/ ........ Personal skills       (-> ~/.agents/skills/<category>/<skill> and ~/.claude/skills/<skill>)
  prompts/ ................ Prompt templates      (-> ~/.pi/agent/prompts/)
  intercepted-commands/ ... Python/pip shims (uv.ts dependency)
  Config files ............ AGENTS.md, APPEND_SYSTEM.md, models.json, etc.
```

Repo-only files such as `README.md`, `SETUP.md`, and `tsconfig.json` live
in `dotfiles/` for documentation and tooling, but are not installed into
Pi.

## Skills

Personal skills live at `dotfiles/personal-skills/<category>/<skill>/`.
Run `npm run dev:sync` after adding or editing one. Pi discovers them from
categorized links under `~/.agents/skills/<category>/<skill>`, while Claude
Code discovers them from flat links under `~/.claude/skills/<skill>` because
Claude Code does not currently discover nested skill directories.

Pi-only skills live at `dotfiles/agent-skills/` and install to
`~/.pi/agent/skills/`. Use this path only for skills that depend on Pi
behavior and should not be shared with Claude Code.

`setup.mjs sync` is intentionally not category-aware in v1 and no longer
scans `~/.agents/skills/`. Create personal skills directly under
`dotfiles/personal-skills/<category>/`, then run `npm run dev:sync`.

Setup refuses to delete non-symlink files or directories in skill install
roots. Third-party and unmanaged directories are reported and left in place.

## Prompt templates

| Prompt | Purpose |
|--------|---------|
| `implementation-plan.md` | Convert an existing plan into actionable, committable checklist phases and write the result to a new Markdown file. |

## Config files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global agent rules: git safety, commit style, PR style, code style, path discipline, cmux integration |
| `APPEND_SYSTEM.md` | System prompt additions: reasoning quality, jCodeMunch policies, documentation lookup, writing style |
| `settings.json` | Pi settings: default provider/model, enabled models, compaction, installed packages. Mutated by Pi at runtime, so it is gitignored and not installed by `setup.mjs`. |
| `models.json` | Custom model/provider definitions (e.g., local models via Ollama) |
| `agent-modes.json` | Per-mode overrides: which provider/model/thinking level to use in debug, review, etc. |
| `damage-control-rules.yaml` | Safety guardrails (see section below) |
| `auth.json.template` | Template for `auth.json` (provider API keys, created on first run) |
| `mcp.json.template` | Template for `mcp.json` (MCP server configuration, created on first run) |

## Extensions

See the [root README Extensions section](../README.md#extensions-26) for the
full list with descriptions.

## Safety guardrails (Damage Control)

The `damage-control/` extension + `damage-control-rules.yaml` form a
safety system that protects against destructive operations:

- **Bash command patterns**: Blocks or prompts for `rm -rf`, `sudo`,
  `git reset --hard`, `git push --force`, AWS/GCP/Firebase/Vercel
  destructive operations, and SQL `DROP`/`TRUNCATE`/`DELETE` without
  `WHERE`.
- **Read-only paths**: System directories, lock files, minified bundles,
  build output, `node_modules/`. Safe discovery commands such as `find`,
  `rg`, `grep`, and `ls` may inspect these paths when they avoid writes,
  helper execution, and mutating `find` primaries.
- **No-delete paths**: `.git/`, config files (`LICENSE`, `README.md`,
  `Dockerfile`, CI configs), `~/.pi/`, `~/.claude/`.
- **AWS S3 allowlist**: Only `ls` and `cp` are permitted; all other S3
  operations are blocked.

## MCP servers

Configured in `mcp.json` (created from `mcp.json.template` on first run).
The template lives in `dotfiles/`, but the real `mcp.json` stays local and
is never committed:

| Server | Purpose | How it runs |
|--------|---------|-------------|
| [jCodeMunch](https://github.com/jgravelle/jcodemunch-mcp) | Code indexing, symbol search, context-aware code exploration. Auto-indexes on session start. | `uvx jcodemunch-mcp` |
| [Postgres MCP](https://github.com/crystaldba/postgres-mcp) | Read-only PostgreSQL access. Runs in Docker with `--access-mode=restricted`. Uses `"lifecycle": "lazy"`. | `docker run crystaldba/postgres-mcp` |
| [MariaDB MCP](https://github.com/MariaDB/mcp) | Read-only MariaDB or MySQL access. Runs via `uvx` with a local connection and optional `MCP_READ_ONLY=true`. | `uvx --from iflow-mcp_mariadb-mariadb-server mariadb-server` |
| [chrome-devtools](https://github.com/nicobailon/chrome-devtools-mcp) | Browser automation via Chrome DevTools Protocol. | `npx chrome-devtools-mcp@latest` |
| [Tirith](https://tirith.sh/) | Local security checks for commands, URLs, pasted content, files, directories, and MCP configs. | `tirith mcp-server` |

[pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) is not an
MCP server. It is a Pi extension that improves how MCP tool responses are
displayed (collapsible output for large results). Install with
`pi install npm:pi-mcp-adapter`.

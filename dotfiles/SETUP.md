# Setup Guide

Post-install configuration and troubleshooting for the `setup.mjs`
workflow. For installation instructions, see the [root README](../README.md).
Run all `node setup.mjs ...` commands from the repo root.

## Prerequisites

### Required

- **[Pi](https://github.com/earendil-works/pi)** coding agent
- **Node.js** (v18+) and **npm**
- **Git**

### Recommended

- **[fd](https://github.com/sharkdp/fd)**: Fast file finder used by some
  extensions. Install: `brew install fd`
- **[uv](https://github.com/astral-sh/uv)**: Python package manager.
  Required for jCodeMunch MCP server (`uvx`). Install: `brew install uv`
- **[Docker](https://www.docker.com/)**: Required for Docker-based MCP servers such as Postgres MCP.
- **[cmux](https://github.com/manaflow-ai/cmux)**: Ghostty-based terminal
  multiplexer. Several extensions and skills integrate with cmux for
  notifications, split panes, and browser automation.
- **[opensrc](https://opensrc.sh/)**: Fetches and caches dependency source
  code for agent context. The agent prompt prefers it over inspecting
  `node_modules/` for dependency internals. Install: `npm install -g opensrc`
- **[Browser Harness](https://github.com/browser-use/browser-harness)**:
  Direct Chrome control for agent-driven browser tasks. The `browser` skill
  is tracked in `manifest.json`, but the CLI must also be installed with
  `uv` as shown below.
- **[Tirith](https://tirith.sh/)**: Offline terminal security for developers
  and AI agents. It adds shell command checks, generated Pi bash-tool
  protection, and MCP tools for checking commands, URLs, pasted content,
  files, directories, and MCP configs. Install: `brew install sheeki03/tap/tirith`

---

## Post-install configuration

### API keys (`auth.json`)

Edit `~/.pi/agent/auth.json` with your provider API keys:

```json
{
  "anthropic": "sk-ant-YOUR_ANTHROPIC_API_KEY",
  "openai-codex": "YOUR_OPENAI_API_KEY",
  "google-antigravity": "YOUR_GOOGLE_API_KEY"
}
```

### MCP servers (`mcp.json`)

Edit `~/.pi/agent/mcp.json` to configure your MCP servers. The template
includes skeletons for jCodeMunch, Postgres MCP, MariaDB MCP,
chrome-devtools, and Tirith. `mcp.json` is always local-only: it is created
from the template on first run and is never symlinked or committed.

### Exa API key

If you use the `exa-search` skill, set your API key:

```bash
export EXA_API_KEY=your_key  # in your shell profile
```

Or create a `.env` file in the skill directory:

```bash
echo 'EXA_API_KEY=your_key' > ~/.pi/agent/skills/exa-search/.env
```

### AgentMemory

[AgentMemory](https://github.com/rohitg00/agentmemory) is tracked in
`manifest.json` as an external skill source, so `setup.mjs` can install the
repo-provided skills such as `remember`, `recall`, `handoff`, and
`session-history`. Those skills are only the agent-facing commands; they do
not install or supervise the local AgentMemory daemon.

Install the daemon globally and wire any non-Pi agents separately:

```bash
npm install -g @agentmemory/agentmemory
agentmemory connect pi
agentmemory connect claude-code
agentmemory connect cursor
agentmemory connect warp
```

The Pi integration uses a native extension rather than MCP. If `agentmemory
connect pi` reports that manual installation is required, follow the upstream
Pi integration guide and place the extension under
`~/.pi/agent/extensions/agentmemory/`.

For always-on local memory, run AgentMemory outside this repo with your
machine's service manager. On macOS, a LaunchAgent works well, but the plist,
wrapper script, and service-account token are intentionally local-only because
they contain machine-specific paths and secret-access policy. If you want
OpenAI-backed embeddings without writing the OpenAI key to disk, use a
1Password service account that can read a non-Personal vault item, store that
service-account token in macOS Keychain, and start AgentMemory through
`op run`.

If you are not using 1Password or macOS Keychain, put provider settings in
AgentMemory's local env file instead. This is simpler, but it stores secrets
on disk, so keep the file private and never commit it:

```bash
agentmemory init
chmod 600 ~/.agentmemory/.env
```

Then edit `~/.agentmemory/.env` and uncomment or add the provider values you
want. For OpenAI embeddings:

```dotenv
OPENAI_API_KEY=sk-your-openai-key
EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

For free local embeddings with no API key:

```dotenv
EMBEDDING_PROVIDER=local
```

After changing `~/.agentmemory/.env`, restart the daemon or your local service
manager so AgentMemory reloads the file.

Useful checks:

```bash
agentmemory status
agentmemory doctor --dry-run
```

---

## MCP server setup

### jCodeMunch (code indexing)

[jCodeMunch](https://github.com/jgravelle/jcodemunch-mcp) provides code
indexing, symbol search, and context-aware code exploration. Works
immediately with the template config. Requires `uvx` (`brew install uv`).

The agent automatically indexes the current repo on session start
(configured in `APPEND_SYSTEM.md`). Incremental indexing keeps subsequent
runs fast.

### Postgres MCP (database access)

[crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp)
runs in Docker with `--access-mode=restricted` for read-only safety.

Add your database connection string under `mcpServers` in `mcp.json`:

```json
{
  "mcpServers": {
    "pg-your-db": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DATABASE_URI",
        "crystaldba/postgres-mcp",
        "--access-mode=restricted"
      ],
      "env": {
        "DATABASE_URI": "postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
      },
      "lifecycle": "lazy"
    }
  }
}
```

- `--access-mode=restricted`: Read-only queries only
- `"lifecycle": "lazy"`: Server starts only when first used
- Add multiple entries for different databases

### MariaDB MCP (database access)

[MariaDB/mcp](https://github.com/MariaDB/mcp) provides read-only MariaDB or
MySQL access through `uvx`. In practice, this setup uses the published
package entrypoint `mariadb-server` from
`iflow-mcp_mariadb-mariadb-server`.

Add your database connection under `mcpServers` in `mcp.json`:

```json
{
  "mcpServers": {
    "mariadb-your-db": {
      "command": "uvx",
      "args": [
        "--from",
        "iflow-mcp_mariadb-mariadb-server",
        "mariadb-server"
      ],
      "env": {
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "3306",
        "DB_USER": "readonly_user",
        "DB_PASSWORD": "your_password",
        "DB_NAME": "your_database",
        "MCP_READ_ONLY": "true",
        "MCP_MAX_POOL_SIZE": "5"
      },
      "lifecycle": "lazy"
    }
  }
}
```

- `MCP_READ_ONLY=true`: Enforces read-only SQL mode in the MCP server
- Prefer a dedicated read-only DB user instead of `root`
- Use `127.0.0.1` for host-local databases when the MCP runs via `uvx`
- `"lifecycle": "lazy"`: Server starts only when first used

### chrome-devtools (browser integration)

[chrome-devtools-mcp](https://github.com/nicobailon/chrome-devtools-mcp)
connects to Chrome DevTools for browser automation. Works out of the box
with `npx`.

### Tirith (terminal and agent security)

[Tirith](https://tirith.sh/) checks shell commands, pasted content, URLs,
AI configuration files, and MCP configs locally. It is not installed by this
repo because it is a system CLI with per-tool local setup, not a Pi package
or external skill.

Install Tirith on macOS:

```bash
brew install sheeki03/tap/tirith
```

Enable Pi's automatic bash-tool guard and the callable MCP tools:

```bash
tirith setup pi-cli --scope user
```

The setup command writes a generated extension to
`~/.pi/agent/extensions/tirith-guard.ts`. Keep using this generated file
rather than committing it to the repo, so future Tirith updates can refresh
it. The MCP template also includes this lazy server entry:

```json
{
  "mcpServers": {
    "tirith": {
      "command": "tirith",
      "args": ["mcp-server"],
      "lifecycle": "lazy"
    }
  }
}
```

For other local AI tools, run the relevant setup commands after installing
Tirith:

```bash
tirith setup cursor --scope user --install-zshenv
tirith setup claude-code --scope user --with-mcp
tirith setup codex --scope user --install-zshenv
tirith setup windsurf --scope user --install-zshenv
```

Use `tirith doctor` after setup and restart any already-running agent
sessions so they reload hooks and MCP config.

### Browser Harness (agent browser control)

[Browser Harness](https://github.com/browser-use/browser-harness) connects
an agent directly to your running Chrome via CDP. The skill is installed
from `manifest.json`; the CLI is installed separately as an editable `uv`
tool so agent-authored helpers in the checkout take effect immediately.

```bash
mkdir -p ~/Developer
git clone https://github.com/browser-use/browser-harness ~/Developer/browser-harness
cd ~/Developer/browser-harness
uv tool install -e .
command -v browser-harness
```

For the normal local-browser flow, open Chrome to
`chrome://inspect/#remote-debugging` and enable remote debugging for the
profile. Then verify the connection:

```bash
browser-harness <<'PY'
print(page_info())
PY
```

Optional cloud browser support requires `BROWSER_USE_API_KEY`. Optional
local profile syncing requires `profile-use` from Browser Use.

---

## Troubleshooting

### Extensions not loading

1. Check that symlinks point to the correct location:
   ```bash
   ls -la ~/.pi/agent/extensions/
   ```

2. Look for dangling symlinks:
   ```bash
   find ~/.pi/agent/extensions -maxdepth 1 -type l ! -exec test -e {} \; -print
   ```

3. If you use development symlinks, re-run `node setup.mjs --link` to
   recreate symlinks and clean up dangling ones.
4. If you use copy mode, re-run `node setup.mjs` from the repo root.

### damage-control blocking a command

If a legitimate command is blocked:

1. Check the rules in `damage-control-rules.yaml`
2. Patterns with `ask: true` prompt for confirmation
3. Patterns without `ask` are hard blocks
4. Add `allow: true` patterns that take precedence over blocks

### Skills not appearing

1. Verify symlinks exist:
   ```bash
   ls -la ~/.pi/agent/skills/
   ls -la ~/.agents/skills/
   ```

2. External skills are not copied from `dotfiles/`. They are installed
   from `manifest.json` unless you used `--skip-external`.
3. Each skill directory must contain a `SKILL.md` file.
4. Restart Pi after adding new skills.

### Custom sub-agent roles not appearing

1. Verify role links exist:
   ```bash
   ls -la ~/.pi/agent/agents/
   ```

2. Each custom role must be a Markdown file with a `name` field in
   frontmatter.
3. Run `/reload` or restart Pi after adding new custom roles.

### npm install fails in damage-control

The `damage-control/` extension has its own `package.json`. `setup.mjs`
runs `npm install` for extension subdirectories that declare deps. If
that fails:

```bash
cd dotfiles/extensions/damage-control && npm install
```

### MCP server not connecting

1. Verify the server is configured in `~/.pi/agent/mcp.json`
2. For jCodeMunch: ensure `uvx` is installed (`brew install uv`)
3. For Postgres MCP: ensure Docker is running (`docker ps`)
4. For MariaDB MCP: ensure `uvx` is installed, the DB host and port are
   reachable, and host-local DBs use `127.0.0.1`
5. For chrome-devtools: ensure `npx` is available

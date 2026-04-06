# Setup Guide

Post-install configuration and troubleshooting. For installation
instructions, see the [root README](../README.md).

## Prerequisites

### Required

- **[Pi](https://github.com/badlogic/pi-mono)** coding agent
- **Node.js** (v18+) and **npm**
- **Git**

### Recommended

- **[fd](https://github.com/sharkdp/fd)**: Fast file finder used by some
  extensions. Install: `brew install fd`
- **[uv](https://github.com/astral-sh/uv)**: Python package manager.
  Required for jCodeMunch MCP server (`uvx`). Install: `brew install uv`
- **[Docker](https://www.docker.com/)**: Required for Postgres MCP servers.
- **[cmux](https://github.com/manaflow-ai/cmux)**: Ghostty-based terminal
  multiplexer. Several extensions and skills integrate with cmux for
  notifications, split panes, and browser automation.

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
includes skeletons for jCodeMunch, Postgres MCP, and chrome-devtools.

### Exa API key

If you use the `exa-search` skill, set your API key:

```bash
export EXA_API_KEY=your_key  # in your shell profile
```

Or create a `.env` file in the skill directory:

```bash
echo 'EXA_API_KEY=your_key' > ~/.pi/agent/skills/exa-search/.env
```

---

## MCP server setup

### jCodeMunch (code indexing)

[jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) provides code
indexing, symbol search, and context-aware code exploration. Works
immediately with the template config. Requires `uvx` (`brew install uv`).

The agent automatically indexes the current repo on session start
(configured in `APPEND_SYSTEM.md`). Incremental indexing keeps subsequent
runs fast.

### Postgres MCP (database access)

[crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp)
runs in Docker with `--access-mode=restricted` for read-only safety.

Add your database connection string to `mcp.json`:

```json
{
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
```

- `--access-mode=restricted`: Read-only queries only
- `"lifecycle": "lazy"`: Server starts only when first used
- Add multiple entries for different databases

### chrome-devtools (browser integration)

[chrome-devtools-mcp](https://github.com/nicobailon/chrome-devtools-mcp)
connects to Chrome DevTools for browser automation. Works out of the box
with `npx`.

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

3. Re-run `node setup.mjs --link` to recreate symlinks and clean up
   dangling ones.

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

2. Each skill directory must contain a `SKILL.md` file.
3. Restart Pi after adding new skills.

### npm install fails in damage-control

The `damage-control/` extension has its own `package.json`. If deps fail:

```bash
cd dotfiles/extensions/damage-control && npm install
```

### MCP server not connecting

1. Verify the server is configured in `~/.pi/agent/mcp.json`
2. For jCodeMunch: ensure `uvx` is installed (`brew install uv`)
3. For Postgres MCP: ensure Docker is running (`docker ps`)
4. For chrome-devtools: ensure `npx` is available

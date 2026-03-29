# Setup Guide

Full walkthrough for setting up pi-agent-toolkit.

## Prerequisites

### Required

- **[Pi](https://github.com/badlogic/pi-mono)** coding agent (installed and
  working)
- **Node.js** (v18+) and **npm**
- **Git**

### Recommended

- **[fd](https://github.com/sharkdp/fd)**: Fast file finder used by some
  extensions. Install: `brew install fd`
- **[uv](https://github.com/astral-sh/uv)**: Python package manager. Required
  for the jCodeMunch MCP server (`uvx`). Install: `brew install uv`
- **[Docker](https://www.docker.com/)**: Required for Postgres MCP servers
  (runs `crystaldba/postgres-mcp` in containers).
- **[cmux](https://github.com/manaflow-ai/cmux)**: Ghostty-based terminal
  multiplexer. Several extensions and skills integrate with cmux for
  notifications, split panes, and browser automation.

---

## Installation

### For users (recommended)

Run once with `npx`, or install the CLI globally for repeated use:

```bash
npx pi-agent-toolkit install

# or
npm install -g pi-agent-toolkit
pi-agent-toolkit install
```

Or install everything at once:

```bash
pi-agent-toolkit install --all
```

Install specific components by category:

```bash
pi-agent-toolkit install --extensions "damage-control commit-approval exa-search-tool"
pi-agent-toolkit install --skills "brainstorm systematic-debugging"
pi-agent-toolkit install --packages "agent-modes prompt-enhancer"
```

### For contributors / personal setup

Clone the repo and symlink so edits flow back:

```bash
git clone https://github.com/danchamorro/pi-agent-toolkit.git
cd pi-agent-toolkit
pi-agent-toolkit install --all --override-configs --link --repo-path .
```

Template configs such as `auth.json` and `mcp.json` are still copied, not
symlinked, so local secrets and machine-specific server settings stay local.

### Managing your setup

```bash
pi-agent-toolkit status    # See what's installed and detect drift
pi-agent-toolkit list      # Browse all available components
pi-agent-toolkit update    # Update the CLI to the latest version
```

### Syncing new work (contributors only)

When pi creates a new extension, skill, prompt, agent, or theme in
`~/.pi/agent/`, or when you add a global skill under `~/.agents/skills/`,
absorb it into the repo:

```bash
pi-agent-toolkit sync --repo-path ~/path/to/pi-agent-toolkit
```

This copies the selected item into `dotfiles/`, replaces the original with a
symlink, and prints the next steps for adding it to the registry.

---

## Post-install Configuration

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

Edit `~/.pi/agent/mcp.json` to configure your MCP servers. The installed
file is created from `mcp.json.template` and uses a top-level `mcpServers`
object. The template includes a skeleton for:

- **jcodemunch**: Code indexing/exploration (works out of the box with `uvx`)
- **Postgres MCP**: Database access via Docker
- **chrome-devtools**: Browser DevTools integration

See the [MCP Server Setup](#mcp-server-setup) section below for details.

### Exa API key

If you use the `exa-search` skill, set your API key using one of these
methods (checked in order):

1. **Environment variable** (recommended): export `EXA_API_KEY` in your
   shell profile.
2. **`.env` file** in the installed skill directory:
   ```bash
   echo 'EXA_API_KEY=your_key' > ~/.pi/agent/skills/exa-search/.env
   ```

---

## MCP Server Setup

### jCodeMunch (Code Indexing)

[jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) provides code
indexing, symbol search, and context-aware code exploration.

**Setup**: Works immediately. The `mcp.json` template includes the config:

```json
{
  "mcpServers": {
    "jcodemunch": {
      "command": "uvx",
      "args": ["jcodemunch-mcp@latest"]
    }
  }
}
```

Requires `uvx` (part of `uv`). Install with `brew install uv`.

The agent automatically indexes the current repo on session start (configured
in `APPEND_SYSTEM.md`). Uses incremental indexing, so subsequent runs are fast.

### Postgres MCP (Database Access)

Uses [crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp)
running in Docker with `--access-mode=restricted` for read-only safety.

**Setup**:

1. Ensure Docker is running
2. Add your database connection string to `mcp.json`:

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

Key details:

- `--access-mode=restricted`: Read-only queries only (no writes)
- `"lifecycle": "lazy"`: Server starts only when first used (saves resources)
- Add multiple entries for different databases

### chrome-devtools (Browser Integration)

[chrome-devtools-mcp](https://github.com/nicobailon/chrome-devtools-mcp)
connects to Chrome DevTools for browser automation.

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--autoConnect"]
    }
  }
}
```

Works out of the box with `npx`.

### pi-mcp-adapter

[pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) improves
how MCP tool responses are displayed in Pi.

Install as a Pi package (not an MCP server):

```bash
pi install npm:pi-mcp-adapter
```

---

## Troubleshooting

### Extensions not loading

1. Check that symlinks point to the correct location:

   ```bash
   ls -la ~/.pi/agent/extensions/
   ```

2. Ensure Pi can see the extensions:

   ```bash
   pi extensions
   ```

3. Check for dangling symlinks:

   ```bash
   find ~/.pi/agent/extensions -maxdepth 1 -type l ! -exec test -e {} \; -print
   ```

### MCP server not connecting

1. Verify the server is configured in `~/.pi/agent/mcp.json`
2. For jCodeMunch: ensure `uvx` is installed (`brew install uv`)
3. For Postgres MCP: ensure Docker is running (`docker ps`)
4. For chrome-devtools: ensure `npx` is available

### damage-control blocking a command

The damage-control system may block commands that match its safety patterns.
If a legitimate command is blocked:

1. Check the rules file for the matching pattern:
   `~/.pi/agent/damage-control-rules.yaml` (installed) or
   `dotfiles/damage-control-rules.yaml` (repo clone)
2. Patterns with `ask: true` will prompt for confirmation
3. Patterns without `ask` are hard blocks
4. You can add `allow: true` patterns that take precedence over blocks

### Skills not appearing

1. Verify symlinks exist:

   ```bash
   ls -la ~/.pi/agent/skills/
   ls -la ~/.agents/skills/
   ```

2. Each skill directory must contain a `SKILL.md` file
3. Restart Pi after adding new skills

### npm install fails in damage-control

The `damage-control/` extension has its own `package.json`. If `npm install`
fails:

```bash
# If installed via CLI:
cd ~/.pi/agent/extensions/damage-control && npm install

# If using a repo clone with symlinks:
cd dotfiles/extensions/damage-control && npm install
```

# Setup Guide

Full walkthrough for setting up the pi-toolkit dotfiles.

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
- **[cmux](https://github.com/nicobailon/cmux)**: Ghostty-based terminal
  multiplexer. Several extensions and skills integrate with cmux for
  notifications, split panes, and browser automation.

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/danchamorro/pi-toolkit.git
cd pi-toolkit
```

### 2. Run the installer

```bash
cd dotfiles
./install.sh
```

The installer will:

1. Check prerequisites
2. Symlink config files into `~/.pi/agent/`
3. Symlink extensions into `~/.pi/agent/extensions/`
4. Symlink `intercepted-commands/` into `~/.pi/agent/`
5. Symlink bundled skills into `~/.pi/agent/skills/` and `~/.agents/skills/`
6. Install 23 external skills from their source repos via `npx skills add`
7. Create `auth.json` and `mcp.json` from templates (first run only)
8. Run `npm install` in extensions with dependencies
9. Install pi packages (`@danchamorro/pi-agent-modes`,
   `@danchamorro/pi-prompt-enhancer`)

If any target file already exists, the installer will prompt you
interactively before overwriting.

### 3. Configure secrets

#### API keys (`auth.json`)

Edit `~/.pi/agent/auth.json` with your provider API keys:

```json
{
  "anthropic": "sk-ant-YOUR_KEY",
  "openai-codex": "YOUR_OPENAI_KEY",
  "google-antigravity": "YOUR_GOOGLE_KEY"
}
```

#### MCP servers (`mcp.json`)

Edit `~/.pi/agent/mcp.json` to configure your MCP servers. The template
includes a skeleton for:

- **jcodemunch**: Code indexing/exploration (works out of the box with `uvx`)
- **Postgres MCP**: Database access via Docker
- **chrome-devtools**: Browser DevTools integration

See the [MCP Server Setup](#mcp-server-setup) section below for details.

#### Exa API key

If you use the `exa-search` skill, add your API key:

```bash
cp dotfiles/agent-skills/exa-search/.env.example dotfiles/agent-skills/exa-search/.env
# Edit .env and set EXA_API_KEY=your_key
```

---

## MCP Server Setup

### jCodeMunch (Code Indexing)

[jCodeMunch](https://github.com/jcodemunch/jcodemunch-mcp) provides code
indexing, symbol search, and context-aware code exploration.

**Setup**: Works immediately. The `mcp.json` template includes the config:

```json
{
  "jcodemunch": {
    "command": "uvx",
    "args": ["jcodemunch-mcp@latest"]
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

Key details:

- `--access-mode=restricted`: Read-only queries only (no writes)
- `"lifecycle": "lazy"`: Server starts only when first used (saves resources)
- Add multiple entries for different databases

### chrome-devtools (Browser Integration)

[chrome-devtools-mcp](https://github.com/nicobailon/chrome-devtools-mcp)
connects to Chrome DevTools for browser automation.

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": ["-y", "chrome-devtools-mcp@latest", "--autoConnect"]
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

**Note**: A PR has been submitted upstream for collapsible response output.
If merged, the standard install works. Otherwise, you can install from the
fork.

---

## Installer Modes

The installer has three modes:

### First-time setup (no flags)

```bash
./install.sh
```

Full interactive setup. Symlinks everything, installs external skills,
creates secret files from templates, installs npm dependencies and pi
packages. Prompts before overwriting any existing files.

### Update (after a pull)

```bash
./install.sh --update
```

Use after `git pull` to pick up changes:

- Creates symlinks for any new files added to the repo
- Reinstalls external skills (idempotent, updates if already present)
- Runs `npm install` in extension dirs (picks up dependency changes)
- Skips secret template setup (won't overwrite your keys)
- Warns about dangling symlinks (files removed from repo)

```bash
cd pi-toolkit
git pull
cd dotfiles
./install.sh --update
```

### Sync (absorb new work into the repo)

```bash
./install.sh --sync
```

Use when you've built a new extension or skill directly in pi (e.g., pi
created `~/.pi/agent/extensions/my-new-thing.ts`) and you want to pull it
into the repo so it's tracked and versioned.

The sync scans `~/.pi/agent/extensions/` and `~/.pi/agent/skills/` for
files that are **not** symlinks (i.e., not already managed by the repo).
For each one found, it prompts:

```
Found new extension: my-new-thing.ts
Move to repo and symlink back? [y/N]
```

If you say yes, it copies the file into `dotfiles/`, replaces the original
with a symlink back to the repo, and you can then commit the change.

External skills (installed via the skills CLI) are automatically skipped.

**Note**: This mode is for repo maintainers and anyone who has forked the
repo as their own setup. If you cloned the repo just to use it, build your
own extensions separately or fork first.

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

1. Check `dotfiles/damage-control-rules.yaml` for the matching pattern
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
cd dotfiles/extensions/damage-control
npm install
```

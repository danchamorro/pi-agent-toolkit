# pi-agent-toolkit

A CLI to selectively install curated extensions, skills, and configs for
the [Pi](https://github.com/badlogic/pi-mono) coding agent. Pick and
choose what you want, or install everything at once.

Includes 22 extensions, 31 skills, 2 installable npm packages, MCP server
configurations, and safety guardrails.

## Install

Run once with `npx`, or install globally:

```bash
npx pi-agent-toolkit install
npm install -g pi-agent-toolkit
```

## Usage

### Interactive picker

Choose exactly what you want from the full catalog:

```bash
pi-agent-toolkit install
```

### Install everything

```bash
pi-agent-toolkit install --all
```

### Install specific components

```bash
pi-agent-toolkit install --extensions "damage-control commit-approval exa-search-tool"
pi-agent-toolkit install --skills "brainstorm systematic-debugging"
pi-agent-toolkit install --packages "agent-modes prompt-enhancer"
```

### Browse the catalog

```bash
pi-agent-toolkit list
```

### Check what's installed

```bash
pi-agent-toolkit status
```

### Update

```bash
pi-agent-toolkit update
```

### Sync unmanaged work back into the repo

Contributor workflow for absorbing unmanaged components created under
`~/.pi/agent/` or `~/.agents/skills/`:

```bash
pi-agent-toolkit sync --repo-path /path/to/pi-agent-toolkit
```

## What's included

### Extensions (22)

Safety and workflow guardrails, search tools, UI panels, and session
management. Highlights:

| Extension | What it does |
|-----------|-------------|
| `damage-control` | Blocks destructive commands, enforces path access rules |
| `commit-approval` | Interactive review before git commits |
| `exa-search-tool` | Semantic web search via Exa |
| `tilldone` | Task list management with progress tracking |
| `review` | Code review for PRs, branch diffs, uncommitted changes |
| `session-breakdown` | Session cost/usage analytics with calendar heatmap |

See the [full extension list](https://github.com/danchamorro/pi-agent-toolkit#extensions-22-total) in the repo README.

### Skills (31)

8 bundled skills (brainstorm, code-review, cli-detector, exa-search,
gh-issue-creator, google-chat-cards-v2, technical-docs, whats-new) plus
23 external skills auto-installed from their source repos.

See the [full skill list](https://github.com/danchamorro/pi-agent-toolkit#skills) in the repo README.

### Packages

Standalone Pi packages installable via `pi install`:

| Package | npm |
|---------|-----|
| [agent-modes](https://www.npmjs.com/package/@danchamorro/pi-agent-modes) | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-agent-modes)](https://www.npmjs.com/package/@danchamorro/pi-agent-modes) |
| [prompt-enhancer](https://www.npmjs.com/package/@danchamorro/pi-prompt-enhancer) | [![npm](https://img.shields.io/npm/v/@danchamorro/pi-prompt-enhancer)](https://www.npmjs.com/package/@danchamorro/pi-prompt-enhancer) |

### MCP Servers

Pre-configured servers for code indexing (jCodeMunch), database access
(Postgres MCP), and browser automation (chrome-devtools).

### Config files

AGENTS.md, system prompt, settings, custom models, agent modes, safety
rules, plus starter `auth.json` and `mcp.json` files created from
templates.

## For contributors

Clone the repo and symlink so edits flow back:

```bash
git clone https://github.com/danchamorro/pi-agent-toolkit.git
cd pi-agent-toolkit
pi-agent-toolkit install --all --override-configs --link --repo-path .
```

Template configs such as `auth.json` and `mcp.json` are still copied,
not symlinked, so local secrets stay machine-specific.

When you create unmanaged extensions, skills, prompts, agents, or themes,
absorb them back into the repo with:

```bash
pi-agent-toolkit sync --repo-path .
```

## License

MIT

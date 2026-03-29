# pi-agent-toolkit CLI: Historical Design Plan

> Historical note: this file captures the original CLI design and the rationale
> behind it. It is no longer the primary source of truth for behavior. For the
> current implementation, see `README.md`, `packages/cli/README.md`,
> `dotfiles/SETUP.md`, and `packages/cli/src/lib/registry.ts`.

## Overview

Replace `dotfiles/install.sh` with a proper CLI that lets users selectively
install components from the pi-agent-toolkit. The CLI acts as an orchestrator on
top of existing install mechanisms (`npx skills add`, `pi install`,
file copy/symlink) rather than reinventing them.

Built for the author first (personal setup across machines), but designed
to be genuinely useful for any pi user who wants curated extensions, skills,
and configs.

## Distribution

- Published to npm as `pi-agent-toolkit` (unscoped, confirmed available)
- `npx pi-agent-toolkit install` for one-off use
- `npm install -g pi-agent-toolkit` for a persistent command
- No repo clone required for other users

## Repo Structure

```
pi-agent-toolkit/
  packages/cli/              # The CLI package (name: "pi-agent-toolkit")
  packages/agent-modes/      # Existing package
  packages/prompt-enhancer/  # Existing package
  dotfiles/                  # Stays as-is, bundled into CLI at publish time
  package.json               # Workspace root
```

The CLI lives at `packages/cli/` as a workspace package, following the
existing monorepo pattern. The `dotfiles/` directory is bundled into the
npm tarball at publish time so users get a self-contained package without
needing to clone the repo.

## Tech Stack

- **Language:** TypeScript
- **Arg parsing:** Citty (lightweight, from the UnJS ecosystem)
- **Interactive prompts:** @clack/prompts (polished multi-select, spinners, confirm steps)

## Commands

The current CLI ships these commands:

```bash
# Interactive picker (first-time or add more)
pi-agent-toolkit install

# Install everything
pi-agent-toolkit install --all

# "New PC" mode: everything, overwrite existing configs
pi-agent-toolkit install --all --override-configs

# Direct install by category
pi-agent-toolkit install --extensions "damage-control commit-approval"
pi-agent-toolkit install --skills "brainstorm docx"
pi-agent-toolkit install --packages "agent-modes"

# Personal symlink mode (requires local repo clone)
pi-agent-toolkit install --link --repo-path ~/Code/pi-agent-toolkit

# Browse the full catalog without installing
pi-agent-toolkit list

# Show what's installed, what's available, detect drift
pi-agent-toolkit status

# Absorb unmanaged components from ~/.pi/agent or ~/.agents/skills
pi-agent-toolkit sync --repo-path ~/Code/pi-agent-toolkit

# Update the CLI to the latest npm version
pi-agent-toolkit update
```

### Future commands

```bash
pi-agent-toolkit uninstall            # Interactive picker to remove components
pi-agent-toolkit uninstall --extensions damage-control
```

These will be added later based on real need.

## Interactive Flow

Step-by-step by category. Each category gets its own prompt screen. Users
can skip entire categories or multi-select within them.

```
$ pi-agent-toolkit install

◆  pi-agent-toolkit
│
◇  Select extensions to install:
│  ◼ damage-control       Safety guardrail engine
│  ◼ commit-approval      Interactive commit review
│  ◻ dirty-repo-guard     Warn on uncommitted changes
│  ...
│
◇  Select bundled skills to install:
│  ◼ brainstorm           Interview-driven planning
│  ◼ exa-search           Semantic web search via Exa
│  ...
│
◇  Select external skills to install (fetched from source repos):
│  ◼ docx                 Word document support
│  ◼ pdf                  PDF support
│  ...
│
◇  Select pi packages to install:
│  ◼ agent-modes          Switch between code, architect, debug modes
│  ...
│
◇  Select starter configs (copied as templates, won't overwrite existing):
│  ● Yes
│
◆  Installing 12 extensions, 10 skills, 2 packages, 5 configs...
```

## Component Categories and Groups

### Extensions (22 total)

| Group    | Extensions                                                           |
|----------|----------------------------------------------------------------------|
| Safety   | damage-control, commit-approval, pr-approval, dirty-repo-guard      |
| Search   | exa-search-tool, exa-enforce                                        |
| Tasks    | tilldone, todos, loop                                                |
| UI       | btw, control, context, files, session-breakdown, term-notify         |
| Review   | review                                                               |
| Workflow | question-mode, qna-interactive, require-session-name-on-exit        |
| Tools    | tools, uv, execute-command                                           |

### Skills

- **Bundled (8):** brainstorm, cli-detector, code-review, exa-search,
  gh-issue-creator, google-chat-cards-v2, technical-docs, whats-new
- **External (23):** Installed via `npx skills add` from source repos.
  Includes docx, pdf, pptx, xlsx, frontend-design, skill-creator,
  agent-browser, playwright-cli, systematic-debugging, and more.

### Packages (2)

- agent-modes
- prompt-enhancer

### Configs (starter templates)

- AGENTS.md, APPEND_SYSTEM.md
- settings.json, models.json, agent-modes.json
- damage-control-rules.yaml
- auth.json, mcp.json (secrets, always templated)

## Install Behavior

| Component type   | Default (other users)    | `--link` mode (author)     |
|------------------|--------------------------|----------------------------|
| Bundled extensions | Copy from npm package  | Symlink to repo clone      |
| Bundled skills     | Copy from npm package  | Symlink to repo clone      |
| Configs            | Copy as templates      | Copy as templates          |
| External skills    | `npx skills add`       | `npx skills add`           |
| Packages           | `pi install`           | `pi install`               |

Configs are never overwritten unless `--override-configs` is passed. Template
configs such as `auth.json` and `mcp.json` are always copied, never symlinked,
so local secrets and machine-specific settings stay local.

## State Tracking

A manifest file at `~/.pi/agent/.pi-agent-toolkit.json` tracks what was
installed, when, and from which CLI version.

```json
{
  "version": "0.5.4",
  "installed": {
    "extensions": ["damage-control", "commit-approval", "exa-search-tool"],
    "skills": {
      "bundled": ["brainstorm"],
      "external": ["docx", "pdf"]
    },
    "prompts": [],
    "agents": [],
    "themes": [],
    "packages": ["agent-modes"],
    "configs": ["AGENTS.md", "damage-control-rules.yaml"]
  },
  "installedAt": "2026-03-29T00:00:00.000Z",
  "updatedAt": "2026-03-29T00:00:00.000Z"
}
```

The `status` command reads this manifest and validates against the
filesystem to detect drift (deleted symlinks, manually added files, etc.).

## Component Registry

A single `registry.ts` file defines all available components. This is the
source of truth for the picker, `list`, and `status` commands.

```ts
{
  name: "damage-control",
  category: "extensions",
  group: "safety",
  description: "Safety guardrail engine: blocks destructive commands",
  method: "copy",          // runtime may symlink when --link is used
  source: "extensions/damage-control",
  recommends: ["damage-control-rules.yaml"]
}
```

## Dependency Handling

Soft warnings only. After the user makes their selections, the CLI checks
the `recommends` map and flags missing companions:

```
⚠  exa-enforce works best with exa-search-tool, which you didn't select.
   Continue anyway? [Y/n]
```

No hard blocks. The user can always proceed.

## Transition Plan (completed)

- ~~Delete `dotfiles/install.sh` when the CLI ships~~ Done.
- ~~Update the repo README to document the CLI-based install flow~~ Done.
- Clean break, no deprecation period (no existing user base relying on
  install.sh beyond the author)

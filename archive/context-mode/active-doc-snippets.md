## APPEND_SYSTEM context-mode scope

Source: `dotfiles/APPEND_SYSTEM.md`

```md
## Context-mode scope

- Context-mode is for large, noisy, or unpredictable output. For small files, exact lookups, or files you may edit, use first-class Pi tools (`read`, `rg`, editor tools) before `ctx_execute_file`.
- Do not write ad hoc analysis scripts when an existing tool answers the task directly.
```

## Root README extension row

Source: `README.md`

```md
| `ctx-approval-gate.ts` | Prompts before execution-capable context-mode tools and hard-blocks nested commits, pushes, PR actions, and destructive shell payloads that must go through direct Bash guardrails |
| `pr-approval.ts` | Intercepts PR creation for interactive review |
| `dirty-repo-guard.ts` | Warns when working in a repo with uncommitted changes |
| `require-session-name-on-exit.ts` | Prompts for a session name before `/quit`, `/q`, `/safe-quit`, or Ctrl+Shift+Q exits |

**Search, tools, and experimental providers:**

| Extension | What it does |
```

## dotfiles README context-mode guard section

Source: `dotfiles/README.md`

```md
`ctx-approval-gate.ts` adds a separate guard for context-mode tools because
those tools can execute nested shell or code payloads outside direct Bash
interception. It prompts before `ctx_execute`, `ctx_execute_file`,
`ctx_batch_execute`, `ctx_upgrade`, `ctx_purge`, and `ctx_insight`; denies
execution when no interactive UI is available; and hard-blocks nested commits,
pushes, PR create or merge commands, and destructive shell patterns so they
must go through direct Bash or first-class Pi tools.
```

## SETUP RTK context-mode safety notes

Source: `dotfiles/SETUP.md`

```md
### RTK shell-output token savings

[RTK](https://github.com/rtk-ai/rtk) is a token-saving CLI proxy for shell
commands. It complements `context-mode` and jCodeMunch rather than replacing
them: RTK reduces output from Bash or shell commands, while `context-mode`
handles large tool output and jCodeMunch handles indexed code navigation.

This repo documents RTK setup but does not install it automatically. RTK is a
system CLI that mutates multiple agent configs outside `~/.pi/agent`, so keep
that installation step explicit on each machine.

Install RTK on macOS:

```bash
brew install rtk-ai/tap/rtk
```

If Homebrew is unavailable, use the upstream installer or pinned GitHub
release from `rtk-ai/rtk`. Avoid `cargo install rtk`, which can install the
unrelated Rust Type Kit package with the same binary name.

Configure the agents used by this toolkit:

```bash
# Claude Code global shell hook
rtk init -g --auto-patch

# Pi global extension
rtk init -g --agent pi

# Cursor global shell hook
rtk init -g --agent cursor --auto-patch

# Codex global instructions
rtk init -g --codex
```

Windsurf uses rules rather than a reliable command-rewrite hook. Add a short
global rule in `~/.codeium/windsurf/memories/global_rules.md`:

```markdown
# RTK shell token savings

For shell commands in Windsurf Cascade, prefer `rtk <command>` instead of the
raw command so common developer output is filtered before it reaches the model
context. Use `rtk proxy <command>` only when exact raw output is required.
```

Verify the setup:

```bash
rtk --version
rtk rewrite 'git status'
rtk init --show
rtk init --show --codex
```

Expected checks:

- `rtk rewrite 'git status'` prints `rtk git status`.
- `rtk init --show` reports the Claude Code hook and Cursor hook.
- `rtk init --show --codex` reports global `RTK.md` and `AGENTS.md`.
- Restart Pi, Claude Code, Cursor, Codex, and Windsurf after setup.

Operational notes:

- RTK rewrites shell commands only. Pi tools, MCP tools, `context-mode`, and
  jCodeMunch calls are not rewritten.
- `ctx-approval-gate.ts` covers execution-capable context-mode tools separately:
  it prompts before `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`,
  `ctx_upgrade`, `ctx_purge`, and `ctx_insight`, and hard-blocks nested commit,
  push, PR, and destructive command payloads so they must use direct Bash or
  first-class Pi tools.
- In Claude Code, existing safety hooks should run before RTK so unsafe Bash
  commands are checked before any token-saving rewrite.
- Use `rtk proxy <command>` for raw output, exact-output debugging, or cases
  where RTK filtering hides details you need.
- Set `RTK_DISABLED=1` in a session to bypass RTK temporarily.

Rollback commands:

```bash
rtk init -g --uninstall
rtk init -g --agent pi --uninstall
rtk init -g --agent cursor --uninstall
rtk init -g --codex --uninstall
```

Remove the Windsurf global rule manually if you added it.

---
```


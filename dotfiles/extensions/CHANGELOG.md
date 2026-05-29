# Extensions Changelog

All notable changes to extensions in `~/.pi/agent/extensions/`.

## 2026-05-28

### subagents.ts

- Added `/subagent start`, `/subagent list`, `/subagent view`,
  `/subagent stop`, and `/subagent reply` for a simple in-process background
  sub-agent MVP.
- Added a compact below-editor status widget for sub-agent status, latest
  activity, elapsed runtime, context usage, results, errors, and pending
  feedback requests.
- Added an `ask_main_session` sub-agent tool so blocked background work can
  pause and request explicit feedback from the main session.
- Made `/subagent view [id]` report status details instead of opening a
  floating overlay.
- Added bundled `planner`, `reviewer`, `scout`, and `worker` role prompts plus
  `/subagent agents` and `/subagent start <role> <task>` support.
- Added a `start_subagent` tool so the main agent can launch a bundled role
  sub-agent without requiring the user to type a slash command.
- Changed `start_subagent` to always wait until the delegated sub-agent finishes
  or asks for feedback, reducing duplicate work in the main session.
- Suppressed full completion posts for tool-launched sub-agents when the tool
  is already returning the delegated result to the main agent.
- Added compact call/result rendering for `start_subagent` so raw sub-agent
  output is hidden until the user expands the tool result or runs
  `/subagent view <id>`.
- Changed sub-agent launches to use fresh child conversation context by default
  instead of seeding the child session with the main session transcript.
- Added `stop_subagent` and `reply_subagent` tools so the main agent can stop a
  sub-agent or answer its feedback request without asking the user to type the
  `/subagent stop` or `/subagent reply` slash commands.

## 2026-05-26

### warp-split-fork.ts

- Added `/warp-tab-fork [optional prompt]` to fork the current Pi session into a
  new named Warp tab using a generated tab config and Warp's URL handler.
- Added experimental `/warp-pane-fork [optional prompt]` to fork into a new pane
  in the current Warp tab via macOS UI automation, with clipboard restoration.
- Forwarded safe parent Pi startup flags, including model, thinking, tool,
  resource, agent-mode, MCP config, and session-control flags, into spawned
  Warp forks while excluding one-shot session targeting flags and API keys.

### pr-approval.ts

- Added `gh pr create --body-file` support so the approval gate reads,
  validates, and previews PR bodies supplied from files before allowing the
  command.
- Resolved the current branch before gating `git push`, including `git -C`
  invocations, so protected-branch checks still apply when the branch is not
  named explicitly.

### question-mode.ts

- Updated read-only discovery guidance to prefer jCodeMunch MCP repo outlines,
  file trees, symbol search, and context bundles over exhaustive file traversal.

## 2026-05-24

### damage-control/

- Commented out the `node_modules/` read-only path rule so dependency files can
  be read and searched without interactive Damage Control approval.

## 2026-05-23

### find-session.ts

- Added a scope picker before session search so queries can be limited to the
  current repo or workspace session bucket, or expanded to all saved Pi
  sessions.

## 2026-05-22

### damage-control/

- Changed `node_modules/` write, edit, and mutating bash attempts from hard
  blocks to one-time interactive approval prompts, while keeping non-UI runs
  denied and leaving other read-only paths hard-blocked.

## 2026-05-18

### exa-search-tool.ts

- Added a compact, non-interactive stats card for Exa results with result bars,
  query context, domains, freshness, content coverage, filters, and cost.

### commit-approval.ts, pr-approval.ts

- Upgraded approval prompts into preflight review dashboards with risk labels,
  metadata summaries, checklists, and focused previews for commits, PRs, merges,
  and protected or force pushes.

### question-mode.ts

- Added a compact read-only status widget and always inject the current mode
  state before agent turns so stale question-mode instructions are explicitly
  cleared after disabling the mode.

## 2026-05-15

### damage-control/

- Relaxed read-only path bash blocking for safe discovery commands such as
  `find`, `rg`, `grep`, and `ls`, while still blocking shell redirection,
  helper execution, and mutating `find` primaries like `-delete` and `-exec`.

## 2026-05-10

### qna-interactive.ts

- Removed the unreliable Ctrl+. shortcut so Q&A extraction is triggered only
  through the `/qna` slash command.
- Added local extraction for straightforward numbered or bulleted questions and
  changed extraction failures to report an error instead of saying cancelled.

### inventory.ts

- Added a Ctrl+Shift+S and `/inventory` overlay that reopens a startup-style Pi
  resource inventory during active sessions, grouped by context files, skills,
  prompt templates, extensions, and extension commands.
- Deduplicated resources with the same display name so skills mirrored across
  multiple user directories appear once in the inventory.
- Limited the command section to extension-owned commands so skill and prompt
  commands do not repeat resources already listed in their dedicated sections.
- Switched the inventory from one long scrolling list to tabs for context,
  skills, prompts, extensions, and extension commands.
- Added descriptions to context files, discovered skills, prompt templates, and
  extensions using frontmatter and extension JSDoc where available.
- Refined the overlay visuals with a cleaner resource-map header, compact tab
  rail, scoped section dividers, and number-key tab shortcuts.
- Improved visual design with cleaner tab bar using dot separators, better
  color hierarchy and consistency, more breathing room between sections,
  simplified header and footer, and enhanced item layout for better readability.
- Fixed overly compact item layout: label, description, and path are now on
  separate indented lines with blank lines between items, and long descriptions
  wrap cleanly within the available panel width.

## 2026-05-07

### all extensions

- Migrated Pi imports from `@mariozechner/*` to `@earendil-works/*` so
  local extension type checking follows Pi 0.74.0 and newer package names.

### damage-control/

- Added `writeAccessPaths` so narrow paths can remain writable through the write
  and edit tools, and usable by bash commands, even when a broader generated-output rule is read-only.
- Allowed writes under `scripts/build/` without relaxing the broader `build/`
  read-only rule. Existing bash pattern guards still apply to destructive commands.
- Fixed bash path extraction so relative paths like `scripts/build` are not also
  checked as the absolute suffix `/build`.

## 2026-05-03

### claude-code-acp/

- Removed the experimental Claude Code ACP provider from the public toolkit
  because ACP session lifecycle, subscription usage visibility, and tool
  boundary behavior are not mature enough for a polished shared extension. The
  implementation and notes were archived locally in the workbench shelf for
  possible future reuse.

## 2026-04-24

### require-session-name-on-exit.ts

- Restored and updated the guarded `/safe-quit`, `/q`, `/quit`, and
  Ctrl+Shift+Q exit flow after Pi's built-in safe-quit prompt was no longer
  available in the current release. The extension now intercepts `/quit` before
  Pi's built-in handler stops the TUI, so unnamed sessions prompt correctly
  without leaving the terminal in a bad state.

## 2026-04-22

### control.ts, context.ts, loop.ts, tilldone.ts, todos.ts

- Added session and todo autocomplete providers so interactive typing can
  suggest live `session:...` targets and `TODO-...` identifiers without
  replacing Pi's built-in slash and file completion.
- Tightened `/context` to use Pi's current exported context-loading APIs
  directly, removing older compatibility shims.

## 2026-04-23

### require-session-name-on-exit.ts

- Removed the extension because Pi now provides built-in safe quit behavior
  that prompts for a session name before exiting, making the local extension
  redundant and avoiding command conflicts with core quit handling.

### loop.ts, tilldone.ts, todos.ts

- Removed the recently added `terminate: true` tool-result hints from loop,
  tilldone, and todo mutations after they proved too aggressive for these
  interactive extensions and could stop the agent immediately after a tool
  call.
- Restored the expected follow-up turn behavior so agents can continue after
  task and todo state changes instead of appearing to stall.

### clean-sessions.ts

- Added explicit working messages and custom working indicators while the
  session scan and trash-move phases are running, so long cleanups feel less
  opaque.

### btw.ts

- Updated the BTW side-chat extension to create side sessions with Pi's
  current string-based tool allowlist API instead of the legacy
  `codingTools` export, restoring compatibility with newer Pi releases.
- Replaced BTW's seed-message initialization to write through
  `session.agent.state.messages`, matching the current agent API after the
  older `replaceMessages()` helper disappeared.

### control.ts, exa-search-tool.ts, loop.ts, tilldone.ts, todos.ts

- Migrated these extensions from `@sinclair/typebox` to `typebox` so local
  typechecking and future Pi compatibility stay aligned with Pi 0.69.0's
  TypeBox 1.x migration.

## 2026-04-17

### commit-approval.ts

- Fixed the commit approval dialog to normalize escaped newline sequences in
  `-m/--message` preview text so commit bodies render as real multi-line
  paragraphs instead of a single literal `\n` line.
- Hardened the commit approval TUI against over-wide render output by wrapping
  commit previews, file lists, validation issues, and footer help text with
  Pi TUI width-safe helpers.
- Tightened commit validation so thin or vague bodies are blocked, while
  concise warnings now nudge authors to explain motivation and impact more
  clearly.
- Normalized escaped newlines before validation too, so single `-m` commit
  messages containing `\n\n` are judged on their real subject/body structure.

### pr-approval.ts

- Fixed the PR approval dialog to wrap long preview and validation lines so
  wide PR titles, bodies, and warning text cannot crash Pi's custom TUI
  renderer.
- Normalized escaped newline sequences in PR body previews so `gh pr create
  --body` content displays as intended in the approval dialog.

### context.ts

- Switched `/context` to Pi's exported `loadProjectContextFiles()` helper so
  context file discovery stays aligned with current Pi behavior instead of a
  repo-local reimplementation.
- Taught `/context` to honor `--no-context-files` and report no AGENTS files
  when Pi was launched with context loading disabled.
- Added lightweight provider response telemetry to `/context`, showing the
  latest HTTP status plus useful headers such as `retry-after`, request id,
  and remaining rate-limit budget when available.

### control.ts

- Replaced hardcoded `Ctrl+O to expand` copy with Pi's dynamic `keyHint()` so
  the expand hint matches the user's active keybinding configuration.

## 2026-04-04

### find-session.ts

- Added a new `find-session` extension with `/find-session [query]` to open a
  dedicated TUI for searching saved Pi sessions across all projects.
- The search flow scans session metadata plus the first and last user
  messages, preserves refinement history, and ranks the best candidates with
  the active model via `completeSimple` before resume.
- The result view supports iterative refinement, arrow-key navigation,
  exact-session switching via `ctx.switchSession()`, and `Ctrl+L` to clear
  the accumulated query history.

## 2026-04-03

### clean-sessions.ts

- Added a new `clean-sessions` extension with `/clean-sessions [days]` to find
  old, low-value session files, preview the cleanup set, and move confirmed
  matches into `~/.pi/agent/sessions/.trash/` instead of deleting them.
- Added `/empty-session-trash` to permanently remove trashed session files
  after a second exact-count confirmation step.
- The cleanup flow preserves manually named sessions, skips the `.trash`
  subtree while scanning, and keeps original directory structure inside trash
  so sessions can be restored manually if needed.

## 2026-04-01

### coach.ts

- Added `/coach last` to reopen the most recent saved coach report in the
  current session. Coach reports are now persisted as hidden session state
  after generation so they can be reopened without rerunning analysis.
- Fixed coaching prompt so label recommendations are framed as solutions
  to navigation problems, not as standalone rituals. The coach now surfaces
  `/tree` (with labels) only when a session is long enough that finding
  key decisions is a real issue.
- Added a new `/coach` command that analyzes the current session plus recent
  sessions for the current working directory and recommends underused PI
  workflows.
- The first coaching heuristics focus on session-oriented features: `/resume`,
  `pi -c`, `/tree`, `/fork`, `/compact`, `/name`, and checkpoint labels inside
  `/tree`.
- Added a lightweight coaching report UI plus local-only usage summaries so the
  extension can explain why each recommendation was made.
- Improved `/coach` with an interactive scope picker so it can analyze either
  the current session only or all sessions in the current working directory.
- Restyled the coaching report with themed section headers, highlighted
  recommendations, and colorized metadata so the view is easier to scan than
  plain white text.
- Rebuilt `/coach` as an LLM-powered deep analysis tool. It now opens every
  session file in the selected scope, parses assistant tool calls to extract
  file access patterns, extracts actual user messages and assistant snippets,
  computes cross-session file overlap, then sends the full evidence bundle to
  the active model for genuine coaching analysis. The output is rendered as
  formatted Markdown with specific, evidence-backed recommendations including
  quoted user messages, named files, and concrete suggestions for skills or
  extensions to build. Quality over speed.

### execute-command (removed)

- Removed the execute-command extension. Will be rebuilt later.

## 2026-03-31

### btw.ts, control.ts, loop.ts, question-mode.ts, review.ts, tilldone.ts, tools.ts

- Removed deprecated `session_switch` and `session_fork` event handlers
  across all seven extensions. Pi now fires `session_start` with an
  `event.reason` field (`"new"`, `"resume"`, `"fork"`) for all session
  transitions, making the separate handlers redundant. Each extension
  already had a `session_start` handler calling the same function.
- Removed the `SessionSwitchEvent` type import from `loop.ts`.

### commit-approval.ts

- Added staged-file previews to the commit approval dialog so approvals show
  what is about to be committed, not just the message.
- Added warnings when staged files still match gitignore rules, which helps
  surface files that were likely staged with `git add -f` or `git add --force`.

### damage-control

- Blocked `git add -f` and `git add --force` in the shared damage-control
  rules so ignored files cannot be force-staged accidentally.
- Blocked `git add` commands that override `core.excludesFile`, such as
  `git -c core.excludesFile=/dev/null add ...`, to prevent bypassing global
  gitignore rules without editing ignore files.

## 2026-03-29

### qna-interactive.ts

- Documented `Ctrl+.` shortcut key in the file header comment.

### files.ts

- Documented `Ctrl+Shift+O`, `Ctrl+Shift+F`, and `Ctrl+Shift+R` shortcut
  keys in the file header comment.

### btw.ts

- Added `Ctrl+Shift+B` keyboard shortcut to open the BTW side chat overlay
  mid-typing without clearing or submitting the current message draft.
- Widened `createSideSession`, `ensureSideSession`, `runBtwPrompt`, and
  `submitFromOverlay` from `ExtensionCommandContext` to `ExtensionContext`
  so the overlay works from both shortcut and command contexts.
- Removed the `waitForIdle` duck-type guard in `submitFromOverlay` (the side
  session runs independently and never needed command-context methods).
- Removed unused `ExtensionCommandContext` import and simplified five
  redundant union types to plain `ExtensionContext`.
- Simplified `extractEventAssistantText` filter predicate to use optional
  chaining instead of a verbose three-line type guard.
- Removed unnecessary destructure in `getModelKey`.

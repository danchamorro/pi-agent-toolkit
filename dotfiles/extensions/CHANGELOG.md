# Extensions Changelog

All notable changes to extensions in `~/.pi/agent/extensions/`.

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

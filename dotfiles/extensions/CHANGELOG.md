# Extensions Changelog

All notable changes to extensions in `~/.pi/agent/extensions/`.

## 2026-05-02

### claude-code-acp/

- Added Pi-authoritative ACP session metadata that replaces the Claude Code
  preset system prompt with a Pi policy prompt, keeps Claude Code built-in tools
  disabled, suppresses SDK settings sources with `settingSources: []`, requests
  auto-memory disablement, and documents the future direction of a Pi-owned MCP
  bridge for selected Pi capabilities.
- Added Claude Code authentication diagnostics that append specific next steps
  for likely login, API key, subscription, Console, or billing failures without
  logging raw adapter stderr in normal errors. Documented `claude auth login`,
  `claude auth status --text`, and the fact that `ANTHROPIC_API_KEY` or
  `ANTHROPIC_AUTH_TOKEN` can take precedence over subscription OAuth in Claude
  Code terminal sessions.
- Added opt-in adapter process persistence with `PI_CLAUDE_ACP_PERSIST`. The
  default remains one process per prompt; persistent mode reuses a compatible
  adapter process while creating a fresh ACP session per prompt, keeping tools
  disabled on every session, serializing prompts per process, and discarding the
  process after unsafe lifecycle failures.
- Added opt-in sanitized ACP transcript diagnostics with
  `PI_CLAUDE_ACP_DEBUG_TRANSCRIPT`. Transcript logs include protocol method
  names, request ids, response status, update types, text lengths, stop
  reasons, selected routes, requested models, stderr byte counts, and process
  lifecycle events without logging raw prompts, rendered context, raw agent text
  chunks, raw JSON-RPC messages, environment variables, auth tokens, raw stderr,
  or raw tool payloads.
- Added ACP protocol validation and clearer diagnostics for malformed JSON-RPC
  envelopes, invalid `initialize`, `session/new`, and `session/prompt`
  responses, malformed session updates, and adapter method errors. Unknown
  well-formed session update types are ignored for forward compatibility.
  Permission requests remain denied and ACP tool-call updates still cancel the
  prompt because file, terminal, tool, and MCP passthrough are disabled.
- Added explicit verified model routes for `sonnet-4-6`, `sonnet-4-5`,
  `opus-4-7-1m`, `opus-4-7`, `opus-4-6`, and `haiku-4-5`. The named routes set
  `ANTHROPIC_MODEL` only for the spawned adapter subprocess, omit broad model
  aliases from the picker, and use debug output as the source of truth for the
  adapter-resolved model.
- Documented how the maintained ACP adapter chooses the underlying Claude
  model, including `ANTHROPIC_MODEL`, Claude Code settings, and sanitized debug
  output from `session/new`. Added debug summaries for ACP `initialize` and
  `session/new` responses without logging prompts, environment variables, file
  contents, or raw payloads. Disabled Claude Code built-in tools when creating
  ACP sessions so milestone-one text-only behavior does not depend on the
  user's Claude Code permission mode.
- Added an experimental text-only Claude Code provider backed by an ACP agent
  process. The first milestone uses `npx -y @agentclientprotocol/claude-agent-acp@0.31.4`
  by default, renders Pi context into a single text prompt, denies permission
  requests, and cancels unsupported tool-call updates so Pi does not provide
  ACP filesystem or terminal passthrough. The adapter process still runs with
  normal OS permissions, so this is not a sandbox.

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

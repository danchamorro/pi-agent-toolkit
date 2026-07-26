# @danchamorro/pi-subagents Changelog

## 0.9.0 - 2026-07-26

### Added

- Added explicit `pi`, `claude`, and `codex` harness selection while preserving
  Pi as the default and Herdr as an optional Pi-only transport.
- Added native Claude Code 2.1.219+ execution through the optional Agent SDK,
  subscription-auth preflight, exact model/effort validation, feedback, and
  bounded cleanup.
- Added a pinned Codex CLI 0.145.0 app-server client with authenticated model
  discovery, dynamic feedback tools, bounded JSON-RPC, and process-tree cleanup.
- Added native harness settings, model/runtime status metadata, legacy
  persistence migration, and a host-aware natural-language harness routing
  skill in the toolkit setup (the skill is not part of the npm tarball).

### Changed

- Split Pi system-prompt composition from harness-neutral child instructions
  without changing existing Pi prompt output.
- Added `max` to Pi thinking-level validation and reject unsupported native
  `off` or `minimal` effort instead of clamping.
- Kept native tool authority explicit: Pi role tool allowlists do not apply to
  native harnesses, Claude denies `Agent` and `Task`, and Codex relies on its
  no-nested-agent instruction rather than a native tool allowlist.
- Let the optional Claude Agent SDK resolve its declared Anthropic and MCP SDK
  peers instead of duplicating them as direct dependencies, and document its
  non-SPDX license metadata and native platform install footprint.

### Fixed

- Fixed native context percentages using cumulative token usage, which could
  display values above 100%; status now uses current Claude context telemetry
  and the latest Codex model-call usage against each context window.
- Persist native executable and session-id display metadata so interrupted
  records retain their diagnostics after reload while legacy records still load.
- Guard Codex notification callbacks so handler failures close the app-server
  instead of escaping process callbacks or skipping cleanup.

### Security

- Native Claude uses `bypassPermissions`; native Codex uses `approvalPolicy:
  never` and `danger-full-access`. The selected cwd is an execution anchor, not
  a sandbox or trust check; callers remain responsible for choosing a trusted
  directory.
- Claude subscription launches reject and strip provider, endpoint, and
  credential environment overrides that could change the backend or billing
  source, and require first-party API authentication. Native credentials,
  session objects, and transcripts are never persisted; only diagnostic session
  ids are retained.

## 0.8.0 - 2026-07-25

### Added

- Added opt-in `subagents.openInHerdr` support for fully interactive child Pi
  sessions in one parent-owned named Herdr session.
- Added an isolated child runtime and private atomic file protocol for activity,
  feedback, stop, completion, and deterministic session result extraction.
- Added unit and opt-in real-Herdr coverage for named parallel tabs, direct
  child input, parent feedback, graceful stop, ID compaction, and cleanup.
- Added one optional focus-safe cmux host surface for the complete Herdr UI;
  outside cmux the same Herdr session runs headlessly with an attach command.
- Added preferred provider-side strict JSON-schema sampling for the
  strict-compatible `subagent_done` completion tool, with automatic fallback for
  unsupported models.

### Changed

- Require Pi 0.82.0 or newer for the typed `agent_settled` lifecycle event.
- Intersect role and ad-hoc child tools with the parent's active tool policy so
  disabled parent tools cannot be re-enabled by delegation.
- Shared launch resolution, limits, status, controls, persistence, and grouped
  completion reporting across in-process and Herdr execution.
- Close the owned Herdr session and optional cmux host after the final
  interactive child reaches a terminal state, restoring the parent pane.
- Scoped persisted records to the exact parent Pi session instead of cwd alone.
  Concurrent sessions can now use the same cwd and `sa-N` ids without seeing or
  overwriting one another.

### Fixed

- Fixed new same-cwd Pi sessions incorrectly displaying another session's
  subagents as interrupted.
- Retried cmux host and Herdr tab shell readiness so slow shell and direnv
  startup cannot drop launch input or force an unnecessary fallback.
- Suppressed isolated-child project trust prompts and preserved external-child
  context usage through completion and stop reporting.
- Preserve the required final result submitted through `subagent_done` so an
  immediate child shutdown cannot produce a false missing-response failure.
- Track session-switch cleanup, tolerate rejected completion promises during
  forced stop, and continue Herdr deletion when server shutdown fails.
- Treat sidecars removed between filesystem checks as missing and ensure child
  completion write failures still dispose resources and shut down.
- Recover a crashed parent's named Herdr session only when a private ownership
  marker proves its owning process exited, without adopting foreign sessions.
- Propagate pre-dispatch cancellation through Herdr child creation and release
  child ownership even when topology cleanup fails.
- Relaunch and attach the shared cmux host after surface replacement and send
  shell commands with a real line terminator.
- Clean partial coordination setup, preserve terminal outcomes during shutdown,
  and finalize timed-out stops even after the Herdr controller is detached.
- Apply persisted-record retention independently per parent session.

## 0.7.0 - 2026-07-14

### Added

- Added optional ephemeral `instructions` to `start_subagent`, allowing the main
  agent to define a task-specific specialization and expected output without
  creating a persistent role or changing child permissions.

### Changed

- Updated main-agent guidance to choose specializations from the delegated work
  and use configured roles only when their reusable prompt and tool policy
  directly match the task.

## 0.6.0 - 2026-05-31

### Added

- Added `subagents.maxConcurrent` (default 5) to cap simultaneously active
  sub-agents and refuse new launches past the cap, guarding against runaway
  cost and provider rate limits.
- Added optional `subagents.idleTimeoutMinutes` (default off) to auto-stop
  working sub-agents that produce no activity for the configured window.
  Sub-agents waiting for feedback are never auto-stopped.
- Added focused tests for the record store, completion reporter, start-argument
  parsing, system-prompt footer stripping, the concurrency cap, and
  streaming-aware completion delivery.

### Changed

- Extracted the in-memory record store (`record-store.ts`), completion reporter
  (`completion-reporter.ts`), and the reload-safe widget timer
  (`reload-safe-timer.ts`) out of `index.ts` so the orchestration logic is unit
  testable without a live Pi session.
- Coalesced high-frequency sub-agent activity writes into a single debounced
  persist and moved run pruning off the per-activity path onto a cheaper
  stat-based prune at record creation, reducing synchronous disk I/O during
  streaming.

### Fixed

- Tool-launched completion reports now capture the streaming follow-up signal at
  launch time instead of at flush time, so a queued user follow-up is still
  routed as a next-turn message even after `turn_end` clears the live signal.

## 0.5.0 - 2026-05-30

### Added

- Added lightweight persisted run metadata for recoverable sub-agent states so
  active work interrupted by a Pi reload remains visible after restart.
- Added an `interrupted` status for sub-agents that were still active when the
  main Pi session shut down.
- Added last-activity tracking and a `no recent activity` status hint for
  long-running sub-agents that have not produced activity recently.

### Changed

- Scoped persisted recovery records to the current working directory and a short
  recovery window so unrelated repos and old completed runs do not appear in
  new sessions.

## 0.4.1 - 2026-05-30

### Changed

- Polished sub-agent status presentation with boxed tables for role lists,
  launch output, and feedback-first status views.
- Randomized the live status widget refresh cadence between 1 and 4 seconds
  while preserving immediate updates for real sub-agent status changes.

## 0.4.0 - 2026-05-30

### Added

- Added guided role discovery output for `/subagent agents`, including workflow
  ordering, role-specific guidance, grouped capability badges, and quick start
  and detail commands.
- Added `/subagent view <role>` support so exact role tools, source details,
  model, and thinking configuration stay available outside the default role
  list.
- Added targeted view tests covering role discovery, role details, and
  feedback-first status output.

### Changed

- Reworked sub-agent status output to prioritize feedback requests before
  running and recent sub-agents, making user action requirements easier to
  spot.
- Applied Pi theme styling to sub-agent role, status, command, and capability
  output while preserving plain-text fallbacks for tests and non-themed
  contexts.

## 0.3.0 - 2026-05-29

### Changed

- Hidden tool-launched completion reports now use Pi's streaming-aware input
  signal to avoid jumping ahead of a user follow-up queued during streaming.
- Sub-agent system prompts now include prompt guidelines for their enabled
  inherited tools using Pi's `getAllTools()` metadata.

## 0.2.1 - 2026-05-29

### Fixed

- Tool-launched sub-agents now report completion or failure back into the main
  session as one hidden follow-up bundle, so the main agent can relay results
  without competing with raw per-agent summaries or silently requiring manual
  `/subagent view` inspection.
- `start_subagent` now terminates the launch turn after the background records
  start, keeping the main session idle and interruptible while sub-agents run
  instead of letting the main agent continue its own duplicate investigation.

## 0.2.0 - 2026-05-29

### Added

- Added custom role discovery from the Pi agent directory's `agents/*.md`
  files, so users can add external sub-agent prompts without editing the
  package.
- Added `settings.json` role overrides for per-role model, thinking, and tool
  settings.
- Added role loader tests covering custom roles, settings overrides, duplicate
  role names, and invalid override diagnostics.

### Changed

- Updated `/subagent agents` output to show whether each role is built-in,
  custom, or settings-overridden.
- Restored `start_subagent` to return immediately after launch so
  natural-language sub-agent delegation stays interruptible.
- Custom role discovery now follows symlinked Markdown files, matching
  repo-managed link-mode setups.
- Custom roles with names that conflict with existing roles are skipped with an
  explicit warning instead of silently replacing bundled behavior.

## 0.1.0 - 2026-05-29

### Added

- Added the initial `@danchamorro/pi-subagents` package for running fresh
  in-process Pi sub-agents from the main session.
- Added bundled `planner`, `reviewer`, `scout`, and `worker` role prompts with
  role-specific model, thinking, tool, and output metadata.
- Added `/subagent` commands for listing roles, starting agents, inspecting
  status, stopping agents, and replying to feedback requests.
- Added main-agent tools for starting, stopping, and replying to sub-agents on
  the user's behalf.
- Added a compact status widget for active and recently finished sub-agents.
- Added README documentation for installation, usage, role metadata, command
  examples, development, and the current MVP scope.

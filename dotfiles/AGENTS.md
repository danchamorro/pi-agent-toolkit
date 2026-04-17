# AGENTS.md

## Global Agent Rules

These rules apply to all repositories unless a project-level AGENTS.md adds stricter rules.

### Git safety

- Do **not** create commits unless the user explicitly asks to commit.
- Do **not** push branches unless the user explicitly asks to push.
- **Never** use `--no-verify` when committing. All pre-commit hooks must pass.
- After making code changes, stop at diff + validation results and ask for approval before any commit.
- If the user asks to "proceed" or "continue," do not infer commit permission.

### Commit message style

When the user explicitly asks to commit, use Conventional Commits:

```text
<type>(<scope>): <subject>

<body>

<footer>
```

- Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `ci`, `build`
- Use imperative mood (e.g., "add" not "added")
- Start subject lowercase, no trailing punctuation, max 50 chars
- Separate subject/body with a blank line; wrap body at 72 chars
- Focus on **why** (the diff already shows what changed)
- No AI attribution and no emojis
- **Always include a body** — single-line commits are not acceptable

Example:

```text
feat(search): add debounced input to federated search

The raw keypress handler was firing a request per keystroke,
causing rate-limit hits on accounts with many companies.

Added a 300ms debounce using useRef + setTimeout so requests
only fire after the user stops typing.
```

### Pull request style

When the user explicitly asks to create a PR, always provide a title and body.

**Title**: Short, descriptive summary of the change (imperative mood, max 72 chars).

**Body** format:

```text
## What changed

Concise summary of the changes. List key files or areas affected.

## Why

Motivation, context, or problem being solved. Link related issues if applicable.

## How tested

What validation was done — tests added/updated, manual checks, commands run.

## Notes (optional)

Breaking changes, follow-ups, deployment considerations, or anything reviewers should know.
```

- Be reasonably detailed without being verbose — a reviewer should understand the change without reading every diff line
- No AI attribution and no emojis
- Always use `--title` and `--body` flags with `gh pr create`

Example:

```text
Title: fix(cache): prevent stale Redis entries after credential rotation

Body:
## What changed

Updated `src/lib/cache/query-cache.ts` to include a credential version
hash in cache keys. Added a cache-bust helper in `src/lib/credentials/`.

## Why

After rotating a company's database credentials, cached query results
continued using the old connection pool key, returning stale or errored
responses until TTL expiry.

## How tested

- Added unit tests for new cache key generation
- Verified manually by rotating credentials and confirming immediate
  cache invalidation
- Ran full CI suite, all checks pass

## Notes

Existing cache entries will expire naturally via TTL. No migration needed.
```

### Code style

- Do **not** use emojis in code (strings, comments, log messages, docstrings).
- To make text stand out, use colors (ANSI codes), bolding, or ASCII symbols instead of emojis.

### Try before asking

When about to ask the user whether they have a tool, command, or dependency installed -- don't ask, just try it. If it works, proceed. If it fails, inform the user and suggest installation. Saves back-and-forth and gives a definitive answer immediately.

### Verify before claiming done

Never claim success without proving it. Before saying "done", "fixed", or "tests pass":
1. Run the actual verification command.
2. Show the output.
3. Confirm it matches the claim.

Evidence before assertions. If about to say "should work now" -- stop. That's a guess. Run the command first.

### Investigate before fixing

When something breaks, don't guess -- investigate first. No fixes without understanding the root cause:
1. **Observe** -- Read error messages carefully, check the full stack trace.
2. **Hypothesize** -- Form a theory based on evidence.
3. **Verify** -- Test the hypothesis before implementing a fix.
4. **Fix** -- Target the root cause, not the symptom.

Avoid shotgun debugging. If making random changes hoping something works, the problem isn't understood yet.

### Trace data to boundaries

When analyzing data flow, trace it all the way to the system boundary before drawing conclusions. Code-level analysis alone can be misleading when external systems (Zapier, HubSpot, third-party APIs, manual processes) are part of the chain.

- If a value appears in a database row, trace where it was written from.
- If it was written from a file or payload, trace who created that file.
- If the creator is an external system outside the codebase, say so explicitly rather than concluding the value "isn't needed" or "comes from the config."
- When the upstream source is outside the codebase, state the boundary clearly: "This value originates from Zapier/HubSpot/external ETL, which is not visible in the code."

### Clean up after yourself

Never leave debugging or testing artifacts in the codebase:
- `console.log` / `print` statements added for debugging -- remove once understood.
- Commented-out code used for testing alternatives -- delete, don't commit.
- Temporary test files, scratch scripts, throwaway fixtures -- delete when done.
- Hardcoded test values (URLs, tokens, IDs) -- revert to proper configuration.
- Disabled tests or skipped assertions (`it.skip`, `xit`, `@Ignore`) -- re-enable or remove.

Before every commit, scan changes for artifacts. If `git diff` shows `console.log("DEBUG")`, a `TODO: remove this`, or a commented-out block -- clean it up first.

### Path discipline

- Do **not** read, search, or inspect files inside `node_modules/` by default.
- Treat `node_modules/` as off-limits unless the user explicitly asks to inspect an installed dependency/package or the installed package is the only source of truth for the behavior in question.
- If inspection of `node_modules/` is genuinely necessary and the user did not explicitly ask for it, ask for permission first.
- When inspection is allowed, keep it tightly scoped to the smallest possible set of named files and never run broad recursive searches over `node_modules/`.
- **Exception — Pi packages:** Reading files under `@mariozechner/` is always allowed without permission. This namespace contains Pi and its related packages (docs, examples, extensions, themes, skills, SDK source).

### Pi toolkit repo awareness

- Treat `~/Documents/Personal/Code/my-projects/pi-agent-toolkit` as the user's personal and public Pi setup repository.
- This repo is where the user saves reusable skills, Pi-related features, and setup changes so they can be shared publicly and used as a backup of their Pi environment.
- When the user asks to create or update Pi skills, Pi features, Pi configuration, or reusable agent tooling, consider this repo a preferred destination when it is relevant.
- Keep changes in this repo polished and shareable. Avoid adding secrets, private tokens, machine-specific credentials, or undocumented local-only assumptions.
- If a requested change seems specific to one machine or not suitable for a public repo, call that out and ask before adding it here.

### Default workflow

1. Make requested edits.
2. Run relevant checks (lint/typecheck/tests as appropriate).
3. Report changed files and results.
4. Wait for explicit commit/push instruction.

### cmux environment

This machine runs cmux (Ghostty-based terminal multiplexer).
When `CMUX_WORKSPACE_ID` is set, the following are available:

**Notifications** — use after long-running tasks complete or fail:
```bash
cmux notify --title "Done" --body "All tests passed"
cmux notify --title "Failed" --body "3 lint errors"
```

**Visual flash** — draw attention to a surface or workspace:
```bash
cmux trigger-flash
```

**Sidebar metadata** — surface progress and status at a glance:
```bash
cmux set-status build "running" --color "#ff9500"
cmux set-progress 0.5 --label "Building..."
cmux log --level success "Deploy complete"
```

**Subagent in split pane** — spawn work in a new split, then read results:
```bash
cmux new-split right
cmux send --surface surface:N "command\n"
cmux read-screen --surface surface:N --lines 50
```

Detailed usage is covered by the `cmux`, `cmux-and-worktrees`, and
`cmux-browser` skills — load those for full reference.







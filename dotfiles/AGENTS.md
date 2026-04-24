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
- Always use `--title` and `--body-file` with `gh pr create` when the body spans multiple lines. Prefer `--body-file` over inline `--body` for any non-trivial PR description to avoid shell escaping and command substitution bugs.

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

Preferred CLI pattern:

```bash
cat > /tmp/pr_body.md <<'EOF'
## What changed
...
EOF

gh pr create --title "fix(cache): prevent stale Redis entries" \
  --body-file /tmp/pr_body.md
```

### GitHub CLI account safety

- Before repo-level `gh` operations such as `gh issue create`, `gh pr create`, `gh pr view`, or `gh repo view`, verify the active GitHub CLI account can see the target repo.
- In multi-account setups, run a lightweight check like `gh repo view` or `gh auth status` before assuming the current account is correct.
- If the repo is missing or returns 404 while git SSH works, check whether the repository's `.envrc` was supposed to switch `gh` to the correct account, then load it if needed before retrying.
- If the wrong account is active after `.envrc` loads, switch explicitly with `gh auth switch` and then continue.

### Code style

- Do **not** use emojis in code (strings, comments, log messages, docstrings).
- To make text stand out, use colors (ANSI codes), bolding, or ASCII symbols instead of emojis.

## Agent-Legible Code, Enforcement, and Reviewability

AI agents work best when the codebase is explicit, searchable, modular, and mechanically enforced. Prioritize changes that make the system easier for both humans and agents to understand.

### 1. Avoid Hidden Magic

Prefer boring, explicit code over clever or implicit behavior.

Agents must avoid introducing patterns that hide intent, control flow, data access, or side effects. If the behavior is not easy to search for, trace, and review, it is probably not agent-legible.

Do not introduce:

- Dynamic imports unless there is already a clear project convention for them.
- Implicit global state.
- Silent fallbacks that hide configuration, permission, database, API, or runtime failures.
- Bare `except`, `catch`, or broad catch-all error handling.
- Multiple competing ways to perform the same operation.
- Business logic hidden inside framework hooks, decorators, model magic, or lifecycle callbacks.
- Raw SQL scattered across the codebase when a query interface or repository layer exists.
- Raw UI primitives when a shared component library exists.
- New abstractions that obscure simple behavior.

Prefer:

- Explicit imports.
- Explicit function arguments.
- Explicit return values.
- Clear module boundaries.
- Searchable names.
- Centralized data access patterns.
- Simple, predictable control flow.
- Errors that fail loudly when the system is misconfigured or in an unsafe state.

If something must be implicit, document why and point to the existing project convention that supports it.

### 2. Respect Mechanical Enforcement

Do not rely on prompts or judgment alone. Follow the project's mechanical guardrails.

Before considering a task complete, run the relevant project-native checks for the affected scope. This may include linting, formatting, type checking, tests, migrations, or build validation. Prefer the narrowest command that covers the files or package you changed, and discover the repo's standard commands before inventing your own.

Agents must not bypass, weaken, delete, or silence enforcement rules just to make a change pass.

Do not:

- Disable lint rules without a clear justification.
- Add broad `ignore`, `noqa`, `type: ignore`, or equivalent comments unless there is no reasonable alternative.
- Remove failing tests instead of fixing the underlying issue.
- Relax type safety to make code compile.
- Add catch-all error handling to hide failures.
- Introduce duplicate helpers, duplicate query paths, or duplicate UI primitives.
- Rename existing concepts casually.
- Create generic function names that collide with existing names.

Prefer:

- Unique, searchable function names.
- One canonical place for each type of operation.
- Existing shared utilities over new one-off helpers.
- Existing component primitives over raw UI elements.
- Existing query/data-access layers over ad hoc access.
- Narrow exception handling with meaningful error behavior.
- Type-safe changes that preserve the existing contract.

If a mechanical rule blocks the change, assume the rule is correct first. Fix the code to satisfy the rule. Only propose changing the rule when the rule is clearly wrong for the project as a whole.

When validation fails, limit automatic fixes to files you touched unless the user explicitly asks for broader cleanup. If a check fails because of pre-existing issues in untouched files, report that clearly instead of modifying unrelated code.

### 3. Keep Changes Small and Reviewable

AI can generate large diffs quickly, but large diffs are harder to review and more likely to hide defects.

Agents should optimize for small, coherent changes that a human can understand.

Prefer:

- One logical change per pull request.
- Minimal diffs.
- Small, focused commits.
- Clear separation between refactoring and behavior changes.
- Incremental implementation over large rewrites.
- Localized changes inside the appropriate module.
- Tests that directly cover the changed behavior.

Avoid:

- Large rewrites unless explicitly requested.
- Drive-by refactors.
- Formatting unrelated files.
- Renaming unrelated symbols.
- Moving code unnecessarily.
- Mixing style cleanup with feature work.
- Touching files outside the task scope.
- Generating thousands of lines of code without a clear review plan.

If a requested change requires a large diff, break it into smaller steps where possible:

1. Add or adjust tests.
2. Make the smallest functional change.
3. Refactor only the affected area.
4. Run checks.
5. Summarize what changed and what should be reviewed carefully.

### 4. Human Review Triggers

Certain changes require extra human attention. When making any of the following changes, clearly call them out in the final response:

- Database migrations.
- Permission or authorization logic.
- Authentication logic.
- Billing logic.
- Security-sensitive behavior.
- Dependency additions or upgrades.
- Production configuration changes.
- Error handling changes.
- Retry, timeout, or background job behavior.
- Data deletion, mutation, or backfill logic.
- Changes that affect reliability, observability, or incident response.

For these areas, do not assume that passing tests is enough. Explain the risk, the intended behavior, and what a human reviewer should verify.

### 5. Completion Checklist

Before finishing a task, verify:

- The code follows existing project patterns.
- The change is explicit and searchable.
- No hidden magic was introduced.
- No enforcement rule was bypassed.
- The diff is as small as reasonably possible.
- Related tests, linters, formatters, or type checks were run where available.
- Any high-risk areas were called out clearly.
- The final summary explains what changed and what needs human review.

The goal is not just code that runs. The goal is code that is understandable, maintainable, reviewable, and safe to own.

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

### Nushell availability

- Nushell (`nu`) is installed on this machine at `/opt/homebrew/bin/nu`.
- Prefer Nushell for interactive shell tasks that benefit from structured data instead of text parsing, especially filesystem inspection, process inspection, JSON/YAML/TOML/CSV/SQLite/Excel exploration, HTTP or API responses, and ad hoc table filtering.
- Common Nushell patterns include `ls | where type == dir`, `ps | where status == Running`, `open package.json | get scripts`, `http get <url> | select ...`, and `help commands | explore`.
- Prefer bash, zsh, or sh when POSIX compatibility matters, when copied shell snippets assume traditional shell syntax, or when the task is mostly external-command orchestration with little structured-data benefit.
- Remember that Nushell built-ins and external commands are distinct. Use `^cmd` to force an external command and convert structured data before piping to external tools with commands such as `to text`, `to json`, `lines`, or `get`.
- For interactive Nushell usage, load the `nushell-shell` skill at `~/.agents/skills/nushell-shell/SKILL.md`.
- For Nushell script, module, and code review work, load the `nushell-pro` skill at `~/.agents/skills/nushell-pro/SKILL.md`.

### Default workflow

1. Make requested edits.
2. After completing a coherent change, run the relevant project-native checks for the affected scope, such as linting, formatting, type checking, and targeted tests.
3. Prefer the narrowest validation command that covers the files or package you changed.
4. Do not fix unrelated pre-existing failures outside the touched scope unless the user explicitly asks.
5. Report changed files and validation results.
6. Wait for explicit commit/push instruction.

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







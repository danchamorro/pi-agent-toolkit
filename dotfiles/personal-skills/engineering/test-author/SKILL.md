---
name: test-author
description: Create or update targeted tests for changed behavior. Use when adding features, fixing bugs, refactoring code, or finding missing coverage, especially when existing tests need to be extended to cover new behavior, edge cases, or regressions.
---

# Test Author

Author tests that match the project’s existing conventions and protect changed behavior. Prefer small, focused tests that a maintainer would keep, not broad generated coverage for its own sake.

## When to use

Use this skill when:

- adding or changing behavior
- fixing a bug that should become a regression test
- refactoring code while preserving behavior
- reviewing code and noticing missing or weak coverage
- updating APIs, data transformations, validation, permission logic, background jobs, or error handling

Do not create tests blindly. First understand the behavior, the project’s test framework, and nearby test patterns.

## Workflow

### 1. Identify the behavior to protect

State the behavior in concrete terms:

- inputs and setup
- action under test
- expected output or side effect
- error path or edge case
- regression being prevented, if any

If the expected behavior is ambiguous, ask before writing tests.

### 2. Discover project conventions

Inspect the narrowest relevant scope:

- package config (`package.json`, `pyproject.toml`, `go.mod`, etc.)
- existing tests near the changed code
- test helpers, fixtures, factories, mocks, and custom assertions
- naming, file placement, setup, teardown, and validation commands

Follow the project’s existing framework and style unless there is a clear reason not to.

### 3. Choose test shape

Prefer:

- extending an existing test file when the behavior belongs there
- creating a new test file only when no appropriate home exists
- testing public behavior over implementation details
- table-driven or parameterized tests for repeated cases
- realistic fixtures with explicit values
- mocks only at system boundaries such as network, database, filesystem, clock, or external services

Avoid:

- brittle snapshots for complex output unless the project already relies on them
- testing private helpers directly when public behavior is sufficient
- duplicating production logic in assertions
- broad mocks that make the test pass without exercising the behavior
- unrelated cleanup or formatting changes

### 4. Cover the right cases

Consider:

- happy path
- boundary values
- missing, null, empty, malformed, or unexpected inputs
- documented error handling
- permission or auth branches
- retry, timeout, cancellation, and idempotency behavior where relevant
- serialization, parsing, and validation at system boundaries
- regressions tied to the original bug or change

Prioritize high-signal cases. More tests are not automatically better.

### 5. Validate narrowly

Run the narrowest project-native command that proves the tests work, for example:

- a single test file
- a package test command
- a related typecheck or lint command if test changes affect types or formatting

If validation fails because of pre-existing unrelated failures, report that clearly and do not fix unrelated files unless asked.

## Output expectations

When proposing or summarizing test work, include:

```markdown
## Behavior covered
- <specific behavior or regression>

## Tests added or updated
- `path/to/test`: <what it verifies>

## Validation
- `<command>`: <result>

## Notes
- <assumptions, uncovered cases, or follow-up recommendations>
```

## Principles

- Tests are executable specifications. Make them readable.
- Match the codebase before introducing new testing patterns.
- Protect user-visible behavior and system boundaries.
- Keep diffs small and reviewable.
- Prefer one precise regression test over broad low-signal coverage.

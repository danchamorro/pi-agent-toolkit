---
name: plan-reviewer
description: Use when reviewing implementation plans, migration plans, refactoring proposals, feature plans, generated implementation trackers, or committable phase plans before execution; especially when asked whether a plan is ready, concrete enough, testable, safe, or dependency-aware.
---

# Plan Reviewer

## Core principle

Review the plan as a quality gate before execution. Your job is to find ambiguity, unsupported assumptions, unsafe sequencing, missing validation, and untracked work before implementation starts.

Do not implement the plan while reviewing it. Inspect files only when needed to verify plan claims.

## Review modes

Classify the plan before judging it:

- **Execution plan**: Must be concrete enough to implement and commit from directly.
- **Design plan**: May be higher level, but must clearly state unresolved decisions and evidence.
- **Discovery plan**: May contain open questions, but must define what will be learned and how.
- **Migration or operations plan**: Must include rollback, verification, safety checks, and failure handling.

Hold execution plans to the strictest standard. Do not reject an early design plan just because it lacks implementation-level detail. Instead, say what is missing before it can become execution-ready.

## What to verify

### 1. Evidence and references

- Verify referenced files exist when codebase access is available.
- Verify referenced functions, classes, commands, configs, migrations, routes, jobs, and tests are real.
- Treat file:line citations as helpful but not required. Line numbers get stale.
- Require evidence for codebase-specific claims. Accept file paths, symbols, tests, configs, docs, logs, or stable line references.
- If evidence cannot be verified, mark the claim as unverified rather than treating it as true.

### 2. Trackability and phase structure

For implementation trackers, check that:

- Work is split into independently reviewable, committable phases.
- Phase tasks use Markdown checkboxes when the plan is meant to track progress.
- Each phase has a clear objective, dependencies, acceptance criteria, validation steps, and a suggested commit message.
- Phase order follows dependency order.
- Each phase is small enough to review without hiding unrelated changes.
- Refactoring, behavior changes, tests, migrations, and rollout work are not mixed unless the plan explains why.

### 3. Testability and acceptance criteria

Acceptance criteria should be objective. Flag criteria that depend on vague human judgment.

Good criteria specify:

- Inputs or setup.
- Expected output or observable behavior.
- Verification method, such as a test command, lint command, type check, manual command, screenshot, API response, or database query.
- Error cases and edge cases where relevant.

Reject wording like "works correctly" unless the plan defines exactly what correct behavior means.

### 4. Specificity

Flag vague language when it hides implementation decisions. Common red flags:

- properly
- correctly
- appropriately
- as needed
- etc.
- and so on
- various
- some
- improve
- enhance
- optimize
- clean up

These terms are acceptable only when followed by measurable detail.

### 5. Dependencies, risks, and safety

Check whether the plan identifies:

- Dependencies between phases.
- External systems or data sources outside the codebase.
- Required credentials, services, migrations, feature flags, queues, cron schedules, or background jobs.
- Rollback or recovery steps for migrations, production config, data mutation, auth, billing, or reliability changes.
- Observability and incident-response implications when behavior affects production operations.

## Review process

1. State the plan being reviewed and the plan type.
2. Read the whole plan before judging individual sections.
3. Verify file references and codebase claims with tools when available.
4. Produce a scorecard.
5. List blocking issues first, then non-blocking improvements.
6. Give one verdict: `APPROVED`, `REVISE`, or `REJECT`.
7. If the verdict is `REVISE`, ask whether the user wants the plan updated. Do not edit the plan until the user confirms.

## Scorecard format

Use this table in every review:

```markdown
## Scorecard

| Area | Result | Notes |
|------|--------|-------|
| Scope and intent | Pass/Revise/Fail | ... |
| Evidence and references | Pass/Revise/Fail | ... |
| Trackability and phase structure | Pass/Revise/Fail | ... |
| Acceptance criteria and tests | Pass/Revise/Fail | ... |
| Dependencies and sequencing | Pass/Revise/Fail | ... |
| Risks, rollback, and operations | Pass/Revise/Fail | ... |
| Specificity | Pass/Revise/Fail | ... |
```

## Verdicts

### APPROVED

Use only when the plan is ready to execute for its stated plan type.

```markdown
VERDICT: APPROVED

The plan is ready for execution.

## Why it passes
- ...

## Verified references
- ...

## Watch points
- ...
```

### REVISE

Use when the plan is directionally sound but needs fixes before execution.

```markdown
VERDICT: REVISE

The plan needs corrections before execution.

## Blocking issues
1. ...

## Minimum changes required for approval
- ...

## Non-blocking improvements
- ...

## Unverified claims
- ...

Would you like me to update the plan file with these fixes?
```

### REJECT

Use when the approach is fundamentally unsafe, unsupported, or too incomplete to revise directly.

```markdown
VERDICT: REJECT

This plan should not be executed as written.

## Fundamental problems
1. ...

## Recommendation
- ...
```

## Optional plan update workflow

Only update a plan after a `REVISE` verdict and explicit user confirmation.

When updating:

- Preserve the plan's intent and structure where possible.
- Fix every blocking issue you identified or clearly mark it as an open question.
- Prefer targeted edits over rewriting the entire file.
- Do not overwrite or replace the plan in place unless the user asked for in-place updates.
- If the user wants a separate revision, create a new Markdown file with a clear name.
- Add an `Issues Found in Review` section only when it helps future readers understand what changed.

After updating, summarize the changed file path, key fixes, and any remaining open questions.

## Common mistakes

- Approving a plan because the idea is good while the execution details are vague.
- Demanding file:line citations for every statement in an early design plan.
- Trusting file references without checking that they exist.
- Treating a checklist as sufficient when dependencies and validation are missing.
- Editing a plan before the user confirms they want changes.
- Implementing code while reviewing the plan.

---
name: gh-issue-creator
description: Use when creating GitHub issues via the `gh` CLI. Covers body structure, issue type classification (bug, feature, task), label selection, and consistent formatting. Triggers on requests to file, create, open, or submit a GitHub issue.
---

# GitHub Issue Creator

Create well-structured GitHub issues using the `gh` CLI with consistent formatting, appropriate labels, and type-specific body templates.

## Ground rules

- Always use `gh issue create` with `--title`, a body flag (`--body` or `--body-file`), and `--label` when a label is appropriate
- Prefer `--body-file` for any multi-line or non-trivial issue body to avoid shell escaping and command substitution bugs
- Auto-detect the repo from the current git context (do not ask the user to specify unless `gh` cannot resolve it)
- In multi-account setups, verify the active `gh` account can see the repo before creating the issue. If the repo has a `.envrc` that switches GitHub users, make sure it has been loaded before falling back to `gh auth switch`.
- Before creating the issue, show the user the exact proposed title, labels, and body, then wait for explicit approval. Do not create the issue immediately after drafting it.
- Exception: if the user provides the exact final title/body text and explicitly says to post it as-is, you may skip the full preview, but still restate the intended action before running `gh issue create`.
- If the workflow includes follow-up GitHub mutations such as adding a comment, editing the issue, or closing it, use the same preview-and-approval rule for the exact action being taken.
- Never include AI attribution or emojis in issue titles or bodies
- Use imperative mood in titles (e.g., "Add retry logic" not "Added retry logic")

## Issue types and label mapping

Classify every issue into one of three types based on user intent. Map to the corresponding GitHub label:

| User intent | GitHub label | When to use |
|---|---|---|
| **Bug** | `bug` | Something is broken, produces wrong results, or crashes |
| **Feature** | `enhancement` | New capability, improvement, or behavioral change |
| **Task** | context-dependent | Maintenance, refactoring, docs, infra work, chores |

If the user says "feature request", "new feature", or "enhancement", use `enhancement`.
If the user says "bug", "broken", "regression", or "not working", use `bug`.
If the user says "task", "chore", "refactor", or "cleanup", pick the most fitting existing label (e.g., `documentation` for docs work) or omit `--label` entirely when nothing fits. Do not force a label.

When uncertain, ask the user which type fits before creating the issue.

## Title guidelines

- Short and descriptive, max 72 characters
- Imperative mood: "Add X", "Fix Y", "Update Z"
- Include the affected area when it adds clarity: "fix(routing): handle missing advertiser ID"
- No trailing punctuation

## Body structure by type

### Feature request (`enhancement`)

```markdown
## Summary

One paragraph describing what the feature does and why it matters.

## Motivation

- Why this is needed
- What problem it solves
- What is painful or missing today

## Proposed Changes

### Before

Show the current state -- code, config, architecture, or behavior.
Use code blocks when showing concrete artifacts.

### After

Show the proposed state with the same level of detail.
Before/after should be directly comparable.

## Implementation Phases

Numbered list of major steps if the work spans multiple PRs or stages.
Skip this section for small, single-PR features.

## Affected Files

List the key files or areas of the codebase that will change.
Group by category (runtime, config, tests, etc.) when helpful.

## Acceptance Criteria

- [ ] Checklist of conditions that must be true for the work to be complete
- [ ] Each item should be independently verifiable
- [ ] Include both functional and testing criteria
```

**Optional sections** (include when relevant):
- **Rollback Strategy** -- for risky or reversible changes
- **Risks** -- known risks and mitigations
- **References** -- links to external docs, RFCs, or related issues

### Bug report (`bug`)

```markdown
## Summary

One paragraph describing the bug and its impact.

## Steps to Reproduce

1. Numbered steps to trigger the bug
2. Be specific about inputs, environment, and timing
3. Include commands, config snippets, or screenshots as needed

## Expected Behavior

What should happen.

## Actual Behavior

What happens instead. Include error messages, logs, or stack traces in code blocks.

## Environment

- OS / runtime version
- Relevant dependency versions
- Any environment-specific context (staging vs prod, specific client config, etc.)

## Possible Cause

If known or suspected, describe the likely root cause.
Skip this section if unknown.

## Acceptance Criteria

- [ ] Bug no longer reproduces under the described steps
- [ ] Regression test added
```

### Task (no label or contextual label)

```markdown
## Summary

One paragraph describing the task and why it needs to happen.

## Context

Background information, motivation, or link to the broader initiative.

## Requirements

- Bulleted list of what the task must accomplish
- Be specific and verifiable

## Acceptance Criteria

- [ ] Checklist of done conditions
```

## Workflow

1. **Determine the issue type** from the user's request or ask if ambiguous
2. **Verify repo access** -- confirm the active `gh` account can see the repo with `gh repo view` or similar. If access is wrong, check whether the repo's `.envrc` should switch accounts, then use `gh auth switch` only if needed.
3. **Map to the correct label** using the table above
4. **Check existing labels** on the repo with `gh label list` to confirm the label exists
5. **Gather enough context** -- if the user's request is brief, check the codebase for relevant details (file paths, current behavior, config shapes) before drafting. Do not ask the user for information you can find yourself.
6. **Draft the title and body** using the appropriate template
7. **Preview and confirm** -- present the exact draft title, labels, and body to the user. Ask for explicit approval or requested edits before any `gh` mutation.
8. **Create the issue after approval** -- for truly short single-line bodies, `--body` is acceptable. For any multi-line, markdown-heavy, or non-trivial body, write to a temp file and use `--body-file`. Default to `--body-file` when in doubt.
9. **Report the issue URL** back to the user

## Adapting the template

The body templates above are starting points. Adjust based on the content:

- **Drop empty sections** -- if there is no rollback strategy or the feature is trivial, omit those sections rather than leaving them blank
- **Add before/after blocks** -- whenever the change involves a concrete artifact (config, API shape, schema, data format), show the before and after states with code blocks
- **Scale detail to complexity** -- a one-line bug fix needs a shorter body than a multi-phase architectural change
- **Preserve the user's language** -- if the user provides specific wording or context, use it rather than rephrasing into generic template language

## What NOT to do

- Do not create issues without `--title` and a body flag (`--body` or `--body-file`) (no interactive mode)
- Do not guess labels that do not exist on the repo
- Do not include a References section unless the user explicitly provides links or references to include
- Do not pad the body with boilerplate when the issue is simple
- Do not skip user approval when the title, labels, body, comment text, or close action were inferred by the agent
- Do not ask the user to specify the repo -- detect it from git context

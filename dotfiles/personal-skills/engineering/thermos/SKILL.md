---
name: thermos
description: "Launch both thermo-nuclear review subagents in parallel. Use for thermos, double thermo review, or combined bug/security and code-quality branch audits."
disable-model-invocation: true
---

# Thermos

Run the two thermo review passes as Pi background sub-agents in parallel.

## Workflow

1. Determine the review scope from the user request, PR, current branch, or relevant changed files.
2. Gather the diff and any file/context excerpts needed for reviewers to evaluate the change without guessing.
3. Launch both roles in one parallel background `subagent` call with `async: true` and `context: "fresh"`:
   - `thermo-nuclear-review-subagent` for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
   - `thermo-nuclear-code-quality-review-subagent` for maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
4. Pass each subagent the same scoped diff/file context and ask it to return prioritized findings with file references and evidence.
5. Return control after launch. Tell the user they can inspect work with `/subagents-fleet` or `subagent({ action: "status" })`, and stop it with `/subagents-stop`.

Do not run the reviews yourself in the main session. If the user later asks for a synthesis after the background reviews finish, summarize only the visible results, deduplicate overlapping findings, and keep the highest-signal issues first.

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
3. Launch both sub-agents with `start_subagent`:
   - `role: "thermo-nuclear-review-subagent"` for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
   - `role: "thermo-nuclear-code-quality-review-subagent"` for maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
4. Pass each subagent the same scoped diff/file context and ask it to return prioritized findings with file references and evidence.
5. Return control to the user after both sub-agents are launched. Tell the user which sub-agents started and that they can inspect results with `/subagent view <id>` or stop work with `stop_subagent`.

Do not run the reviews yourself in the main session. If the user later asks for a synthesis after the background reviews finish, summarize only the visible results, deduplicate overlapping findings, and keep the highest-signal issues first.

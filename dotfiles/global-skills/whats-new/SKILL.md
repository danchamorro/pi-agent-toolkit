---
name: whats-new
description: Analyze git changes between branches and generate a changelog entry. Use when catching up on repo changes, after merges, or when asking "what's new in the codebase?"
context: main
---

# whats-new

Analyze git changes and generate a changelog entry to help track what's new in the codebase.

## Trigger

- `/whats-new` - Compare current branch to origin/master (default)
- `/whats-new <branch>` - Compare to a specific branch
- `/whats-new --since "2 weeks ago"` - Time-based comparison
- "What's new in the repo?"
- "Catch me up on changes"

## Workflow

### Step 1: Determine Comparison Target

Parse the user's input to determine what to compare against:
- If no argument: compare `HEAD` to `origin/master`
- If branch name provided: compare `HEAD` to that branch
- If `--since` provided: use time-based git log

### Step 2: Gather Git Information

Run these commands to understand the changes:

```bash
# Fetch latest from remote
git fetch origin

# Get commit summary
git log --oneline HEAD..<target> 2>/dev/null || git log --oneline <target>..HEAD

# Get file change statistics
git diff --stat HEAD..<target> 2>/dev/null || git diff --stat <target>..HEAD

# Get list of new files
git diff --name-status HEAD..<target> 2>/dev/null | grep "^A" || git diff --name-status <target>..HEAD | grep "^A"

# Get list of modified files
git diff --name-only HEAD..<target> 2>/dev/null || git diff --name-only <target>..HEAD
```

### Step 3: Analyze Changes

For each significant area of change, provide architectural context:

**Areas to analyze:**
- `src/model/` - New data models, schema changes
- `src/service/` - New business logic, services
- `src/tasks/` - Celery tasks, background jobs
- `src/api/` - New endpoints, API changes
- `src/cli/` - New commands, CLI enhancements
- `src/repository/` - Data access patterns
- `src/schema/` - Pydantic validation schemas
- `etc/settings.toml` - Configuration changes
- `migrations/` - Database migrations

**For each new file or significant change:**
1. Read the file to understand its purpose
2. Identify key classes, functions, patterns
3. Note how it relates to existing code
4. Highlight any new dependencies or patterns introduced

### Step 4: Generate Changelog Entry

Create a markdown file at `.notes/changelog/YYYY-MM-DD-<branch-name>.md` with this structure:

```markdown
---
date: YYYY-MM-DD
branch: <branch-name>
compared_to: <target-branch>
author: <from git log if available>
---

# <Branch Name> Changes

## Summary
<1-2 sentence overview of what this branch adds>

## New Capabilities
- <Capability 1>: Brief description
- <Capability 2>: Brief description

## New Files

### Models
| File | Purpose |
|------|---------|
| `src/model/example.py` | Description |

### Services
| File | Purpose |
|------|---------|
| `src/service/example.py` | Description |

### Tasks
| File | Purpose |
|------|---------|
| `src/tasks/example.py` | Description |

<... other sections as needed ...>

## Modified Files
- `path/to/file.py` - What changed and why

## New Patterns to Know
- **Pattern name**: Explanation of new pattern or convention introduced
- **Configuration**: Any new settings in `etc/settings.toml`

## New CLI Commands
```bash
# command - description
python -m src.cli <command>
```

## New API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/...` | Description |

## Database Changes
- New migrations: `migrations/versions/xxx_description.py`
- Schema changes: ...

## Dependencies
- New packages added to `pyproject.toml`
```

### Step 5: Report Summary

After creating the changelog entry:
1. Display a brief summary to the user
2. Show the path to the created file
3. Highlight the most important things to know

## Output Location

All changelog entries go to: `.notes/changelog/`

Naming convention: `YYYY-MM-DD-<branch-name-slug>.md`

Examples:
- `2025-01-13-dmng-3-monitoring.md`
- `2025-01-10-dmng-2-data-model.md`

## Notes

- Always fetch from origin before comparing to ensure you have latest changes
- Focus on architectural significance, not just file listings
- Identify patterns that the user should adopt in future work
- If comparing to a branch that has YOUR changes (you're ahead), flip the comparison direction
- Keep the changelog entry focused and scannable

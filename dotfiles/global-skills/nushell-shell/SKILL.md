---
name: nushell-shell
description: Use when a task involves interactive Nushell usage, Bash or zsh one-liner translation to Nu, structured pipeline exploration, or deciding whether a terminal task should use Nushell instead of a traditional shell.
---

# Nushell Shell

## Overview

Nushell is most useful as an interactive, data-centric shell. Treat command output as typed tables, records, and lists, then query fields directly instead of parsing display text with string tools.

Use this skill for everyday terminal work in Nu. Use `nushell-pro` when writing or reviewing reusable `.nu` scripts, modules, custom commands, or security-sensitive Nu code.

## When to Use

Use this skill when:
- A user asks how to do something in Nushell
- A bash, zsh, or fish pipeline should be translated into idiomatic Nu
- The task is exploratory or interactive, not a reusable `.nu` program
- You need to inspect files, processes, environment data, config files, JSON, YAML, TOML, CSV, SQLite, Excel, or API responses
- You need to decide whether Nu or a traditional shell is the better fit
- You need to combine Nu built-ins with external commands safely

Do not use this skill as the main guide for:
- POSIX shell scripts
- Login-shell compatibility questions that depend on bash, zsh, or sh behavior
- Deep `.nu` authoring, type signatures, modules, or script reviews, load `nushell-pro` for those

## Core Mental Model

1. Prefer Nu built-ins that return structured data, such as `ls`, `ps`, `open`, `http get`, `help commands`, and `sys`
2. Query fields, do not parse rendered output
3. Pipes between Nu commands carry structured data, not just strings
4. Rendering commands are not the data itself. `table` changes presentation, while `get`, `select`, `where`, and `sort-by` change the data
5. Internal and external commands are different:
   - `ls` runs Nushell's built-in command
   - `^ls` runs the external system command
   - convert Nu data before sending it to externals with `to text`, `to json`, `lines`, or a narrowed value from `get`

## Quick Reference

### Everyday patterns

| Task | Nu pattern |
| --- | --- |
| List only directories | `ls | where type == dir` |
| Show largest files | `ls | where type == file | sort-by size | reverse | first 10` |
| Keep only selected columns | `ls | select name type size modified` |
| Extract just values | `ls | get name` |
| Inspect running processes | `ps | where status == Running` |
| Open JSON or YAML | `open package.json` or `open config.yaml` |
| Query nested data | `open package.json | get scripts` |
| Query SQLite | `open app.db | query db "select * from users"` |
| Fetch API data | `http get <url> | select name id` |
| Explore nested output | `help commands | explore` |
| Render as a table | `... | table` |

### Choosing `get` vs `select`

- `get` extracts values from the structure
- `select` keeps part of the structure as a table, list, or record

Examples:
- `ls | get name` returns a list of names
- `ls | select name size` returns a smaller table

### Built-ins vs external commands

Use Nu built-ins first when they already expose structured data.

Examples:
- `ls | where type == dir`
- `ps | where cpu > 10`
- `open package.json | get version`

Use external commands when you need behavior Nu does not provide or when the external tool is the real source of truth.

Examples:
- `^git status`
- `ls | get name | to text | ^grep README`
- `http get <url> | to json | ^jq '.items[0]'`

## When Nu Is a Good Fit

Prefer Nushell when:
- The task is interactive and exploratory
- The output already has fields, rows, columns, or nested structure
- You would otherwise reach for `grep`, `awk`, `cut`, or `sed` mainly to recover structure
- Cross-platform built-ins are helpful
- You want rich inspection with `describe`, `help`, and `explore`

## When Nu Is Not the Best Fit

Prefer bash, zsh, or sh when:
- POSIX compatibility matters
- A copied snippet assumes traditional shell parsing or shell startup behavior
- The workflow is mostly external-command orchestration with little structured-data value
- The target environment expects standard shell semantics for login or bootstrap scripts

## Common Beginner Gotchas

- Running Nu syntax in zsh or bash. Start Nushell first with `nu`, or run a one-off with `nu -c '<pipeline>'`
- Forgetting that Nu pipes structured data between built-ins
- Forgetting `^` when a command name conflicts with a Nu built-in
- Sending a rendered table to an external command without converting it first
- Using `select` when you really need raw values from `get`
- Assuming `table` transforms the underlying data. It usually just changes rendering
- Expecting traditional shell redirection habits. In Nu, `save`, `open`, structured commands, and Nu redirection syntax are often the better fit
- Assuming Nu should replace every shell. It is excellent for data-centric terminal work, but not a universal POSIX replacement

## Recommended Workflow

1. Start with `nu` for an interactive session, or `nu -c '<pipeline>'` for a one-off
2. Inspect shapes with `describe`, `columns`, `help <command>`, and `help commands | explore`
3. Prefer Nu built-ins before external tools when the data is naturally structured
4. Convert data intentionally before piping to externals
5. Escalate to `nushell-pro` when the work becomes reusable `.nu` code

## Useful Official Topics

When deeper guidance is needed, prioritize these official Nushell book sections:
- Quick Tour
- Thinking in Nu
- Coming from Bash
- Pipelines
- Working with Tables
- Navigating and Accessing Structured Data
- Loading Data
- Running System (External) Commands
- Nu as a Shell
- Configuration
- explore

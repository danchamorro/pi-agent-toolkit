## Rule priority

When instructions in this file conflict with project-level AGENTS.md rules, this file takes precedence. Within this file, more specific rules override general ones.

## Implementation philosophy

- Follow YAGNI principles: prefer the smallest clear solution, including one-liners when sufficient.

## Reasoning and feedback quality

- Avoid sycophancy and uncritical agreement.
- Challenge user assumptions respectfully when needed.
- Ground responses in facts, best practices, and clear logic.
- Present pros and cons (trade-offs) to the user instead of always agreeing.
- If a user request conflicts with evidence or best practices, explain why and propose better alternatives.

## jCodeMunch MCP usage policy

- On session start, **only if the current working directory is inside a git
  repository** (i.e., `git rev-parse --is-inside-work-tree` succeeds), call
  `jcodemunch_index_folder` with `path` set to the current working directory.
  Skip indexing entirely for non-repo directories (e.g., `~`, `~/Downloads`,
  `~/Documents`) to avoid needlessly indexing personal files. Incremental
  incremental indexing is cheap because it only re-processes changed files, so
  this is safe to run unconditionally when inside a repo. If the call fails
  on the first attempt (server still connecting), retry once before falling
  back.
- All jCodeMunch tools are prefixed with `jcodemunch_`. The `index_folder`
  tool requires the parameter name `path` (not `folder_path`).
- **Do not begin code exploration until `index_folder` has fully completed.**
  Wait for the indexing result before calling any other jCodeMunch tools or
  reading source files. Never index "in parallel" with analysis.
- Re-index (`index_folder`) after git pull, branch switches, or when retrieved
  symbols appear stale or do not match file contents.
- For code exploration and understanding, prefer jCodeMunch tools over reading
  full files:
  - Use `get_repo_outline` or `get_file_tree` to understand project structure.
  - Use `search_symbols` to locate functions, classes, and methods by name.
  - Use `get_symbol` or `get_symbols` for precise source retrieval.
  - Use `get_context_bundle` before making edits to understand a symbol's
    imports, neighbors, and related code.
  - Use `get_blast_radius` before modifying widely-used symbols.
  - Use `get_file_outline` to inspect a file's symbols before pulling source.
- Reserve Pi read, bash, and grep tools for: exact-string lookups (error
  messages, config values, log text), non-code files (config, JSON, YAML,
  markdown), and files outside the indexed repository.

## Preferred CLI tools

- **ripgrep** (`rg`) is installed. Prefer over `grep` for searching file contents. Faster, respects `.gitignore`, and has sane defaults. Example: `rg "pattern"` instead of `grep -r "pattern"`.
- **fd** is installed. Prefer over `find` for locating files by name or pattern. Simpler syntax, faster, respects `.gitignore`. Example: `fd "filename"` instead of `find . -name "filename"`.
- **sd** is installed. Prefer over `sed` for find-and-replace in files. No escaping headaches. Example: `sd 'old' 'new' file.txt` instead of `sed -i '' 's/old/new/g' file.txt`.
- **jq** is installed. Use for JSON processing in shell pipelines. Example: `curl -s api/endpoint | jq '.data[]'` to extract fields from JSON responses.
- **yq** is installed. Use for YAML processing with the same syntax as jq. Example: `yq '.services.web.ports' docker-compose.yml` to query YAML configs.
- **gh** is installed. Use for all GitHub operations (PRs, issues, workflows, API calls). Example: `gh pr create`, `gh run list`, `gh api`.

## Documentation lookups

- When giving advice about library/framework APIs, state your confidence
  level about version currency.
- If the user is working with a recent or rapidly-changing library, use
  Exa to verify against current docs before answering.
- When uncertain about API details, search the library's official docs
  site via Exa (e.g., includeDomains: ["react.dev"]) rather than
  guessing from training data.
- Do not substitute browser automation or ad-hoc web fetching for normal
  documentation lookup when Exa is available. If Exa cannot satisfy the
  request, say so explicitly before considering another path.

## Tool-first approach

- Before writing custom code to accomplish a task, check for relevant existing tools, skills, MCP servers, or CLI utilities that are likely to handle the request.
- Purpose-built tools are often faster, more reliable, and better maintained than ad-hoc scripts.
- Only fall back to writing custom code when no available tool covers the requirement or when the tool's output needs non-trivial post-processing.

## OpenSRC source lookups

- The `opensrc` CLI is installed for fetching external source code into a
  global cache at `~/.opensrc/`.
- For public API usage and recommended patterns, prefer official
  documentation via Exa first. Use `opensrc` when the task requires learning
  a public repository, inspecting package internals, debugging implementation
  behavior, or resolving ambiguity that docs and types do not cover.
- Prefer `opensrc` over inspecting `node_modules/` for dependency internals.
  It retrieves source repositories and keeps them out of the current project.
- Use `opensrc path <spec>` to fetch on cache miss and print the absolute
  cached source path. Compose the returned path with `rg`, `fd`, `read`, or
  targeted editor commands:
  - npm: `opensrc path zod`, `opensrc path npm:react`, `opensrc path zod@3.22.0`
  - PyPI: `opensrc path pypi:requests`
  - crates.io: `opensrc path crates:serde`
  - GitHub: `opensrc path vercel/next.js`, `opensrc path https://github.com/vercel-labs/opensrc`
  - GitLab: `opensrc path gitlab:owner/repo`
- Use `opensrc fetch <spec...>` to prime the cache for one or more sources
  without printing paths, for example `opensrc fetch zod pypi:requests
  crates:serde vercel/next.js`.
- For npm packages inside a project, pass `--cwd <project-dir>` when lockfile
  version resolution matters, for example `opensrc path zod --cwd .`.
- Use `opensrc list` or `opensrc list --json` to see cached sources. Do not
  run `opensrc clean` or remove cached sources unless the user asks, or the
  cache is stale or corrupt and you explain the reason.
- Keep exploration narrow. Search for specific symbols, files, or error text
  instead of reading entire fetched repositories.

## Writing style

- Do not use em dash punctuation in prose. Use commas, parentheses, colons, semicolons, or separate sentences instead.
- CLI flags such as long options are allowed when they are part of a command.

## Git commit writing

- When the user explicitly asks to commit, write commit messages with a useful body, not just a valid one.
- The body must explain why the change was needed, what constraint or problem it addresses, and any important behavior or impact.
- Avoid vague bodies like "update config", "fix issue", "minor cleanup", or text that merely repeats the subject.
- Prefer 2 to 4 sentences in wrapped paragraphs, with enough detail that a reviewer can understand the motivation without opening the diff.
- If the proposed commit body feels thin, revise it before presenting commit approval.

## Web search date bias

- When searching for year-specific recommendations (e.g., "best CLI tools of YYYY", "top libraries in YYYY"), always derive the year from the `Current date` field in the session context. Do not default to the last year of training data. LLMs tend to anchor on their training cutoff year; override that instinct and use the actual current year.

## External data preference

- For factual claims, version-specific APIs, and time-sensitive information, prefer external verification over internal knowledge.
- If accuracy is uncertain or information may be outdated, search for external data before answering.
- Do not guess when data can be retrieved. When in doubt, retrieve.
- If information cannot be confidently verified, state the uncertainty explicitly rather than presenting it as fact.
- Ask a clarifying question if missing inputs would lead to an unreliable answer.
- For web search, semantic lookup, similar-page discovery, and general web research, use the `exa_search` tool.
- Do not use ad-hoc web search methods (`python requests`, `curl`, direct scraping) unless the user explicitly requests direct URL fetch.
- Do not use browser automation as a fallback for ordinary web lookup when Exa can handle the task. Reserve browser tools for interactive flows, authentication, screenshots, UI testing, or explicit user requests.
- Prefer responses with cited source links from search results.

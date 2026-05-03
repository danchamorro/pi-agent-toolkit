# claude-code-acp extension

Experimental Pi provider that sends text prompts to Claude Code through an ACP agent process.

## What it registers

Provider id: `claude-code-acp`

Model routes:

| Model id | What it requests |
|---|---|
| `default` | Adapter default. Leaves `ANTHROPIC_MODEL` unchanged, so the adapter uses your environment, Claude Code settings, or SDK default. |
| `sonnet-4-6` | Requests `ANTHROPIC_MODEL=claude-sonnet-4-6` for the adapter subprocess. |
| `sonnet-4-5` | Requests `ANTHROPIC_MODEL=claude-sonnet-4-5` for the adapter subprocess. |
| `opus-4-7-1m` | Requests `ANTHROPIC_MODEL=opus[1m]` for the adapter subprocess. This is the verified Opus 4.7 1M route. |
| `opus-4-7` | Requests `ANTHROPIC_MODEL=claude-opus-4-7` for the adapter subprocess. This is not the 1M route. |
| `opus-4-6` | Requests `ANTHROPIC_MODEL=claude-opus-4-6` for the adapter subprocess. |
| `haiku-4-5` | Requests `ANTHROPIC_MODEL=claude-haiku-4-5` for the adapter subprocess. |

These routes request adapter model preferences. The ACP `session/new` debug line is the source of truth for what the adapter actually selected. The broad `sonnet`, `opus`, and `haiku` aliases, plus the old `claude-code-acp` model id, are intentionally omitted from the picker to keep model selection explicit. `claude-haiku-3-5` and exact `*-1m` IDs such as `claude-opus-4-7-1m` were tested but rejected by the adapter/account used during implementation, so `opus-4-7-1m` uses the adapter's working `opus[1m]` alias.

The default command is:

```bash
npx -y @agentclientprotocol/claude-agent-acp@0.31.4
```

This package was verified on npm at `0.31.4` while implementing the first milestone and is pinned by default so adapter changes do not silently alter protocol behavior. The adapter was previously published as `@zed-industries/claude-agent-acp`, but the maintained package now lives under the Agent Client Protocol namespace.

## Authentication and billing boundary

Claude Code authentication is separate from Pi and from Pi's Anthropic API provider settings. This ACP provider launches Claude Code through the adapter, so Claude Code decides which credential and billing path is active.

Pre-authenticate outside Pi before using this provider. The extension does not implement ACP `authenticate`, `/login`, or a login UI. For subscription-backed Claude Code usage, run:

```bash
claude auth login
claude auth status --text
```

`claude auth status --text` is an opt-in preflight check you can run manually. It exits successfully when Claude Code is logged in and shows the active login in human-readable form.

Claude Code's terminal authentication can prefer credential environment variables over subscription OAuth. If `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` is present, Claude Code may use that credential instead of your Claude Pro, Max, Team, or Enterprise subscription login. If you expect subscription-backed usage, check your environment and unset those variables before launching Pi when they should not apply.

Claude Code also supports Console login and API-key-based usage. Those paths can affect billing differently from subscription-backed usage. Verify the active method with Claude Code's own status and billing tools before relying on a specific billing path.

When the adapter emits likely authentication or billing failures, this extension adds a short next-step diagnostic to the Pi error without logging raw stderr. `PI_CLAUDE_ACP_DEBUG=1` still prints raw adapter stderr for local debugging only.

## Underlying Claude model selection

The Pi provider is still an ACP adapter route, not a direct Anthropic Messages API provider. The explicit model routes set `ANTHROPIC_MODEL` only for the spawned adapter subprocess. They request a model from Claude Code, but the adapter may resolve aliases differently depending on account, subscription tier, adapter version, and available models.

For `claude-code-acp/default`, Pi does not set `ANTHROPIC_MODEL`. With `@agentclientprotocol/claude-agent-acp@0.31.4`, the adapter's initial model priority is:

1. `ANTHROPIC_MODEL` in the environment that launches Pi.
2. Claude Code settings `model` value.
3. The first model returned by the Claude Agent SDK.

Claude Code settings are loaded from:

- `~/.claude/settings.json`
- `<cwd>/.claude/settings.json`
- `<cwd>/.claude/settings.local.json`
- platform managed settings, such as `/Library/Application Support/ClaudeCode/managed-settings.json` on macOS

The adapter can expose the current and available models after ACP `session/new`. To inspect that without logging prompts, file contents, auth tokens, or environment variables, run Pi with debug enabled:

```bash
PI_CLAUDE_ACP_DEBUG=1 pi --model claude-code-acp/default --no-tools --no-session -p "Reply with exactly: debug ok"
```

Look for a sanitized line like:

```text
[claude-code-acp] session/new: sessionId=... currentModel=... availableModels=...
```

Example commands:

```bash
pi --model claude-code-acp/default --no-tools
pi --model claude-code-acp/sonnet-4-6 --no-tools
pi --model claude-code-acp/sonnet-4-5 --no-tools
pi --model claude-code-acp/opus-4-7-1m --no-tools
pi --model claude-code-acp/opus-4-7 --no-tools
pi --model claude-code-acp/opus-4-6 --no-tools
pi --model claude-code-acp/haiku-4-5 --no-tools
```

The adapter also supports model changes through ACP session configuration. This extension uses per-request environment overrides for now because each Pi request creates a fresh ACP session.

## Instruction authority

Each ACP session is created with Pi-authoritative metadata. The extension sends a string `_meta.systemPrompt` that tells the adapter to treat Pi-provided instructions, context, AGENTS files, skills, tool policy, and user messages as authoritative. It also sends Claude Agent SDK options intended to suppress Claude Code filesystem instruction sources: `settingSources: []`, `tools: []`, `mcpServers: {}`, and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

This keeps the provider aligned with Pi's instruction hierarchy while preserving text-only behavior. Sentinel validation confirmed that project `CLAUDE.md`, `.claude/CLAUDE.md`, and `.claude/skills` markers were not repeated in assistant output or sanitized transcript logs with the pinned adapter version.

This is not a sandbox or a guarantee that no Claude Code configuration is read. The adapter may still read selected Claude settings JSON for environment, model, effort, or permission-mode metadata before SDK options are applied. Custom adapter commands or newer adapter versions can also change behavior, so use sanitized transcript/debug checks when validating a different setup.

Future tool work should use a Pi-owned MCP bridge: selected Pi capabilities exposed as MCP tools, with Pi enforcing tool selection, permissions, logging, and policy. Claude Code native tools and user Claude Code MCP config remain disabled by default and should not be enabled as a shortcut to Pi tools.

## Opt-in Pi MCP bridge

Set `PI_CLAUDE_ACP_PI_MCP_BRIDGE=1` to expose a Pi-owned read-only MCP server to Claude Code for the current ACP session. The bridge is off by default. When enabled, Pi passes exactly one MCP stdio server in ACP `session/new`; Claude Code built-in tools remain disabled with `tools: []`, SDK settings sources remain disabled with `settingSources: []`, and user Claude Code MCP configuration is not passed through.

The MVP bridge exposes only these tools:

- `pi.files.read_text`: read one UTF-8 text file under the active cwd.
- `pi.files.list`: list direct children of a directory under the active cwd.
- `pi.files.search_text`: search literal text under the active cwd.

The bridge denies mutation and execution capabilities. There are no write, edit, delete, move, terminal, bash, subagent, or arbitrary Pi tool execution tools. It also denies secret-looking paths such as `.env`, key files, token files, credential files, and known secret directories. The MVP does not use `.gitignore`; it relies on cwd boundaries, realpath symlink checks, secret-path denial, binary detection, and size/result limits.

Bridge limits are configurable with:

| Variable | Default |
|---|---|
| `PI_CLAUDE_ACP_MCP_MAX_FILE_BYTES` | `262144` |
| `PI_CLAUDE_ACP_MCP_MAX_RETURNED_CHARS` | `65536` |
| `PI_CLAUDE_ACP_MCP_MAX_SEARCH_MATCHES` | `50` |
| `PI_CLAUDE_ACP_MCP_MAX_LIST_ENTRIES` | `200` |
| `PI_CLAUDE_ACP_MCP_TOOL_TIMEOUT_MS` | `10000` |
| `PI_CLAUDE_ACP_MCP_MAX_CONCURRENT_CALLS` | `2` |

This is read-only file access, not a sandbox. It can still reveal non-secret project files that match the policy. Keep it disabled unless you explicitly want Claude Code ACP to inspect files through the Pi-owned bridge.

## Protocol diagnostics

The extension validates the minimal ACP JSON-RPC protocol surface it uses before trusting adapter messages. Malformed JSON, invalid JSON-RPC envelopes, invalid `initialize`, `session/new`, or `session/prompt` responses, and malformed session updates fail the request with an explicit error. Unknown but well-formed session update types are debug-logged and ignored for forward compatibility.

Permission requests are still denied automatically. With the bridge disabled, tool-call updates still cancel the prompt because tool, file, terminal, and MCP passthrough remain disabled. With the opt-in Pi MCP bridge enabled, only tool-call updates for the three approved Pi bridge tools are allowed; unexpected tool-call updates still fail closed. Adapter error diagnostics include the ACP method when available, the selected Pi route, the requested adapter model, and the configured adapter command.

## Safe transcript diagnostics

Set `PI_CLAUDE_ACP_DEBUG_TRANSCRIPT=1` to emit compact ACP protocol transcript lines on stderr. This is independent from `PI_CLAUDE_ACP_DEBUG` and is intended for safer bug reports.

```bash
PI_CLAUDE_ACP_DEBUG_TRANSCRIPT=1 \
PI_CLAUDE_ACP_TIMEOUT_MS=60000 \
pi --model claude-code-acp/default --no-tools --no-session -p "Reply with exactly: transcript ok"
```

Transcript lines include method names, request ids, response status, route, requested model, stop reason, session update type, content type, text length, stderr byte counts, and process lifecycle events. Transcript mode does not log raw prompts, rendered Pi context, file contents, environment variables, auth tokens, raw JSON-RPC messages, raw adapter stderr, raw tool payloads, or raw agent text chunks.

`PI_CLAUDE_ACP_DEBUG` still emits the existing human-readable debug summaries and raw adapter stderr chunks. Prefer `PI_CLAUDE_ACP_DEBUG_TRANSCRIPT=1` when sharing diagnostics.

## Configuration

Set these environment variables before launching Pi if you need to override the default adapter command:

| Variable | Description | Default |
|---|---|---|
| `PI_CLAUDE_ACP_COMMAND` | Executable to spawn | `npx` |
| `PI_CLAUDE_ACP_ARGS_JSON` | JSON array of command arguments | `["-y", "@agentclientprotocol/claude-agent-acp@0.31.4"]` |
| `PI_CLAUDE_ACP_TIMEOUT_MS` | Prompt timeout in milliseconds | `300000` |
| `PI_CLAUDE_ACP_DEBUG` | Set to `true`, `1`, `yes`, or `on` for debug logs on stderr | unset |
| `PI_CLAUDE_ACP_DEBUG_TRANSCRIPT` | Set to `true`, `1`, `yes`, or `on` for sanitized ACP protocol transcript logs on stderr | unset |
| `PI_CLAUDE_ACP_PERSIST` | Set to `true`, `1`, `yes`, or `on` to reuse a compatible adapter process while still creating a fresh ACP session per prompt | unset |
| `PI_CLAUDE_ACP_PI_MCP_BRIDGE` | Set to `true`, `1`, `yes`, or `on` to expose the opt-in Pi-owned read-only MCP bridge | unset |

Example using a globally installed adapter:

```bash
PI_CLAUDE_ACP_COMMAND=claude-agent-acp \
PI_CLAUDE_ACP_ARGS_JSON='[]' \
pi
```

## Milestone limitations

By default this is intentionally text-only.

- Claude Code built-in tools are disabled when creating the ACP session.
- No filesystem passthrough is advertised unless `PI_CLAUDE_ACP_PI_MCP_BRIDGE=1` is set.
- No terminal passthrough is advertised.
- No MCP server passthrough is advertised unless the opt-in Pi-owned read-only MCP bridge is enabled.
- Permission requests are cancelled automatically.
- Tool call updates from the ACP agent are treated as unsupported and cancel the prompt. The current Pi MCP bridge executes through MCP and should not surface ACP tool-call updates to Pi; unexpected ACP tool-call updates still fail closed.
- Images and previous tool calls are rendered as explicit omitted markers in the prompt.
- Token usage is estimated from rendered prompt and streamed output text because Claude Code subscription-backed ACP does not expose Pi-priced usage. Cost is still reported as zero because subscription usage is not token-priced through Pi.

Ask for explanations, plans, patches in text, or opt into the read-only Pi MCP bridge for limited file inspection. Do not rely on this provider to edit files directly. These limitations are not a sandbox: the adapter process still runs in the repository working directory with the current process environment and operating-system permissions.

## Runtime behavior

By default, each Pi model request starts the configured ACP command over stdio, initializes ACP, creates a fresh ACP session for the current working directory, sends one rendered text prompt, streams text chunks back into Pi, and then stops the child process.

Set `PI_CLAUDE_ACP_PERSIST=1` to opt into reusing a compatible adapter process across prompts. Persistent mode still creates a fresh ACP session for every prompt and keeps Claude Code built-in tools disabled on every `session/new`. Processes are reused only when the configured command, arguments, resolved working directory, Pi model route, and requested adapter model match. Prompts sharing one persistent process are serialized because ACP adapter concurrency has not been validated.

Persistent mode is not the default because background process lifecycle bugs can leave orphaned adapter processes. The extension attempts to close persistent children on process shutdown, discards idle persistent processes after a short grace period, and discards a persistent process after timeout, abort, fatal protocol errors, child exit/error, tool-call cancellation, or other unsafe states. Use `PI_CLAUDE_ACP_DEBUG_TRANSCRIPT=1` when validating persistent behavior so process reuse and discard events are visible.

The implementation uses a minimal JSON-RPC newline-delimited ACP client instead of the TypeScript SDK so the milestone remains small and explicit.

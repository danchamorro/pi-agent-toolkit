# claude-code-acp extension

Experimental Pi provider that sends text prompts to Claude Code through an ACP agent process.

## What it registers

- Provider id: `claude-code-acp`
- Model id: `claude-code-acp`
- Display name: `Claude Code via ACP (experimental)`

The default command is:

```bash
npx -y @agentclientprotocol/claude-agent-acp@0.31.4
```

This package was verified on npm at `0.31.4` while implementing the first milestone and is pinned by default so adapter changes do not silently alter protocol behavior. The adapter was previously published as `@zed-industries/claude-agent-acp`, but the maintained package now lives under the Agent Client Protocol namespace.

## Authentication and billing boundary

Claude Code authentication is separate from Pi and from Anthropic API keys. The ACP adapter is responsible for Claude Code login and billing behavior.

Pre-authenticate outside Pi before using this provider. The extension does not implement ACP `authenticate`, `/login`, or a login UI. To use a Claude Pro or Max subscription, authenticate through Claude Code or through the ACP adapter's own login flow. Do not assume Pi's Anthropic API key settings apply to this provider, and verify the adapter's current billing behavior before relying on subscription usage.

If `ANTHROPIC_API_KEY` is present in your environment, Claude Code or its adapter may choose API billing instead of subscription billing. Check the adapter documentation and your environment before using this provider for real work.

## Underlying Claude model selection

The Pi model `claude-code-acp/claude-code-acp` means “send this request through the Claude Code ACP adapter.” It does not currently mean Sonnet, Opus, or any specific Claude model.

Pi does not choose the underlying Claude model yet. With `@agentclientprotocol/claude-agent-acp@0.31.4`, model selection is handled inside the adapter and Claude Code. Based on the maintained adapter source, the initial model priority is:

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
PI_CLAUDE_ACP_DEBUG=1 pi --model claude-code-acp/claude-code-acp --no-tools --no-session -p "Reply with exactly: debug ok"
```

Look for a sanitized line like:

```text
[claude-code-acp] session/new: sessionId=... currentModel=... availableModels=...
```

The adapter also supports model changes through ACP session configuration, but this extension intentionally does not expose Sonnet, Opus, or exact Claude model aliases yet. That is planned for the next phase after we verify the safest way to request and label models.

## Configuration

Set these environment variables before launching Pi if you need to override the default adapter command:

| Variable | Description | Default |
|---|---|---|
| `PI_CLAUDE_ACP_COMMAND` | Executable to spawn | `npx` |
| `PI_CLAUDE_ACP_ARGS_JSON` | JSON array of command arguments | `["-y", "@agentclientprotocol/claude-agent-acp@0.31.4"]` |
| `PI_CLAUDE_ACP_TIMEOUT_MS` | Prompt timeout in milliseconds | `300000` |
| `PI_CLAUDE_ACP_DEBUG` | Set to `true`, `1`, `yes`, or `on` for debug logs on stderr | unset |

Example using a globally installed adapter:

```bash
PI_CLAUDE_ACP_COMMAND=claude-agent-acp \
PI_CLAUDE_ACP_ARGS_JSON='[]' \
pi
```

## Milestone 1 limitations

This is intentionally text-only.

- Claude Code built-in tools are disabled when creating the ACP session.
- No filesystem passthrough is advertised.
- No terminal passthrough is advertised.
- No MCP server passthrough is advertised.
- Permission requests are cancelled automatically.
- Tool call updates from the ACP agent are treated as unsupported and cancel the prompt.
- Images and previous tool calls are rendered as explicit omitted markers in the prompt.
- Token usage and cost are reported as zero because subscription usage is not token-priced through Pi.

Ask for explanations, plans, or patches in text. Do not rely on this provider to edit files directly. These limitations are not a sandbox: the adapter process still runs in the repository working directory with the current process environment and operating-system permissions.

## Runtime behavior

Each Pi model request starts the configured ACP command over stdio, initializes ACP, creates a fresh ACP session for the current working directory, sends one rendered text prompt, streams text chunks back into Pi, and then stops the child process.

The implementation uses a minimal JSON-RPC newline-delimited ACP client instead of the TypeScript SDK so the first milestone remains small and explicit.

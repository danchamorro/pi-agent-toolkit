---
name: 1password-developer
description: Work with 1Password developer features including SSH key management, the SSH agent, 1Password Environments for secrets injection, and the op CLI. Use this skill whenever the user mentions 1Password, op CLI, 1Password SSH agent, 1Password Environments, secret references, op run, op inject, or wants to manage SSH keys through 1Password, secure .env files with 1Password, or inject secrets at runtime. Also trigger when the user wants to stop storing plaintext secrets on disk or asks about securing developer credentials.
---

# 1Password Developer Workflows

This skill covers the 1Password developer toolchain: SSH key management via the SSH agent, secrets injection via Environments, and the `op` CLI.

## Quick Reference

| Tool | Purpose |
|---|---|
| 1Password Desktop App | SSH agent, key imports, environment management |
| `op` CLI (stable) | Item management, secret references, `op run`, `op inject` |
| `op` CLI (beta) | Adds `op run --environment` and `op environment read` |
| SSH Agent | Serves keys from 1Password vaults to SSH/Git clients |
| Environments | Store and inject env vars at runtime without plaintext on disk |

## SSH Key Management

### Supported key types

1Password supports only these SSH key types:
- **Ed25519** (recommended, fastest, most secure)
- **RSA**: 2048, 3072, and 4096-bit only

Not supported: ECDSA, DSA, RSA keys larger than 4096-bit (e.g., 6096-bit), PuTTYgen `.ppk` format.

Check a key's type and size before importing:

```bash
ssh-keygen -lf ~/.ssh/your_key
# Output: 256 SHA256:abc... user@host (ED25519)
# Output: 4096 SHA256:xyz... user@host (RSA)
```

### Importing SSH keys

The CLI **cannot** import existing SSH keys. This is a desktop-app-only operation.

From the official docs: "To import an existing SSH key, use the 1Password desktop app."

To import via the desktop app:
1. Navigate to the target vault in the sidebar
2. Select **New Item > SSH Key**
3. Select **Add Private Key > Import a Key File**
4. Navigate to the key file and import
5. If the key has a passphrase, enter it once
6. Save

The CLI can only **generate** new keys:

```bash
op item create --category ssh --ssh-generate-key ed25519 --title "My New Key" --vault Private
```

### Watchtower for SSH keys

The 1Password Developer Watchtower (Developer > View Watchtower) scans `~/.ssh/` and shows:
- **Needs Attention**: Unencrypted keys on disk
- **Recommendations**: Keys that can be imported or managed

Some keys show "Import" buttons, others show "Show in Finder" with an Import option in the dropdown.

### SSH Agent setup

The 1Password SSH agent serves keys from vaults without exposing private keys to SSH clients.

**macOS agent socket**: `~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock`

**Enable in the app**: Settings > Developer > Set Up SSH Agent

**Configure your SSH client** (`~/.ssh/config`):

```
Host *
  IdentityAgent "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
```

**Verify the agent sees your keys**:

```bash
SSH_AUTH_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" ssh-add -l
```

### Agent config for custom vaults

By default, the agent only serves keys from the built-in Personal, Private, or Employee vault. For shared or custom vaults, create `~/.config/1Password/ssh/agent.toml`:

```toml
[[ssh-keys]]
vault = "Private"

[[ssh-keys]]
vault = "Bridge"

[[ssh-keys]]
vault = "Business"
```

You can use vault names or vault UUIDs. Get vault IDs with:

```bash
op vault list --format=json | jq -r '.[] | "\(.id) \(.name)"'
```

**Important**: Creating this file overrides the default behavior entirely. If you create it, you must explicitly include your Private/Personal vault or its keys will no longer be available.

The 1Password app may need to be quit and relaunched to detect a newly created agent.toml file.

### Using keys after they're in 1Password

Once keys are in 1Password and the agent is configured, update `~/.ssh/config` to point `IdentityFile` at the **public key** (not the private key). The public key acts as a hint telling the agent which key to offer:

```
# Before (private key on disk)
Host github.com
  IdentityFile ~/.ssh/my_key

# After (public key hints to agent, private key lives in 1Password)
Host github.com
  IdentityFile ~/.ssh/my_key.pub
```

Public keys are not secret and can stay on disk. This approach also avoids the SSH server 6-key limit.

## 1Password Environments

Environments store key-value pairs (like `.env` files) in 1Password and make them available at runtime.

### Creating an Environment

Done through the desktop app: Developer > View Environments > New Environment. You can import variables from an existing `.env` file or add them manually.

### Injecting secrets with `op run --environment`

This is the recommended approach. Requires the **beta CLI** (v2.33.0-beta.02+):

```bash
op run --environment <environment-id> -- npm run dev
```

How it works:
1. You authenticate once at process start
2. `op` fetches all variables from the Environment
3. Variables are injected into the subprocess as environment variables
4. Secrets exist only for the duration of the process
5. Any secret values appearing in stdout/stderr are automatically masked

Get the environment ID: In the app, select the Environment > Manage environment > Copy environment ID.

### Wrapping other toolchains

`op run` works with any command, not just `npm`. It injects environment variables into the subprocess, so you can stack it with other toolchains:

```bash
# Node.js
op run --environment <env-id> -- npm run dev

# Python with uv
op run --environment <env-id> -- uv run python my_script.py

# Python with venv
op run --environment <env-id> -- python my_script.py

# Docker
op run --environment <env-id> -- docker compose up

# Any command
op run --environment <env-id> -- <your-command>
```

This also works for repos without a long-running server (standalone scripts, data pipelines, automation jobs). If the scripts use `load_dotenv()` and `os.getenv()`, remove the plaintext `.env` file from disk and `op run` becomes the only source of secrets. No code changes needed.

### The masking problem

`op run` masks any stdout/stderr text matching a secret value. This causes issues when environment variables contain short, common strings (like `/sign-in`, `info`, `true`, `root`, `3306`) that appear in normal log output.

**Solution**: Split variables into two groups:
- **1Password Environment**: Actual secrets (API keys, passwords, tokens, connection strings, credentials)
- **`.env.local` on disk**: Non-secret config (URL paths, log levels, feature flags, port numbers, database names)

`op run` merges both sources. Variables from the Environment override those from the shell/`.env` files.

### Other ways to use Environments

**Mounted `.env` file** (macOS/Linux only): 1Password creates a virtual file (UNIX named pipe) at a path you specify. Requires Touch ID each time the file is read. Configure in the app: Environment > Destinations > Local `.env` file.

**Programmatic access**:

```bash
op environment read <environment-id>
```

**Service accounts** (CI/CD): Use a service account token instead of biometric auth for headless environments. Same `op run --environment` command works.

## CLI Reference

### Installation

**Stable** (Homebrew):
```bash
brew install 1password-cli
```

**Beta** (direct download, needed for `--environment` flag):
```bash
curl -sS -o /tmp/op_beta.pkg "https://cache.agilebits.com/dist/1P/op2/pkg/v2.34.1-beta.01/op_apple_universal_v2.34.1-beta.01.pkg"
sudo installer -pkg /tmp/op_beta.pkg -target /
```

The beta installs to `/usr/local/bin/op`. If Homebrew's stable version takes precedence in PATH, alias it:

```bash
alias op=/usr/local/bin/op
```

Check release notes and beta versions: https://app-updates.agilebits.com/product_history/CLI2

### Useful commands

```bash
# Check version
op --version

# List vaults
op vault list

# List SSH keys across all vaults
op item list --categories 'SSH Key'

# Get item details
op item get "Item Name" --vault "Vault" --format json

# Run with environment injection
op run --environment <env-id> -- <command>

# Read a secret reference
op read "op://Vault/Item/Field"

# Inject secrets into a template file
op inject -i config.template -o config.yml

# Run with an env file containing secret references
op run --env-file=.env -- <command>
```

## Common Pitfalls

1. **CLI cannot import SSH keys.** Only generate new ones. Import existing keys through the desktop app.

2. **agent.toml overrides defaults.** Creating the config file means you must list ALL vaults you want, including your default Private vault.

3. **agent.toml needs app restart.** The app may not detect a newly created config file until restarted.

4. **6096-bit RSA keys not supported.** 1Password maxes out at 4096-bit RSA. Check key size with `ssh-keygen -lf` before attempting import.

5. **ECDSA keys not supported.** Only Ed25519 and RSA work with the SSH agent.

6. **`op run` masking is aggressive.** Keep short common strings out of 1Password Environments to avoid log corruption. Split secrets from config.

7. **Beta vs stable CLI.** The `--environment` flag for `op run` requires the beta channel. The stable CLI does not have it yet.

## Documentation Links

- SSH key management: https://developer.1password.com/docs/ssh/manage-keys/
- SSH agent setup: https://developer.1password.com/docs/ssh/agent
- SSH agent config (agent.toml): https://developer.1password.com/docs/ssh/agent/config/
- Environments: https://developer.1password.com/docs/environments/
- Local .env files: https://developer.1password.com/docs/environments/local-env-file/
- op run (secrets injection): https://developer.1password.com/docs/cli/secrets-environment-variables/
- Secret references: https://developer.1password.com/docs/cli/secret-references/
- CLI release notes: https://app-updates.agilebits.com/product_history/CLI2
- Full developer docs (LLM-friendly): https://developer.1password.com/llms-full.txt

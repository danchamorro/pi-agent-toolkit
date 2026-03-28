#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# pi-toolkit dotfiles installer
#
# Usage:
#   ./install.sh            First-time interactive setup
#   ./install.sh --update   Update mode (skip secret prompts, only
#                           prompt for genuinely new files)
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="$HOME/.pi/agent"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
UPDATE_MODE=false
SYNC_MODE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

usage() {
  echo "Usage: $0 [--update] [--sync]"
  echo ""
  echo "  --update   Skip secret template setup. Only prompt for new files."
  echo "  --sync     Find new extensions/skills in pi that aren't in the repo"
  echo "             yet and offer to absorb them."
  exit 1
}

info()    { echo -e "${CYAN}[INFO]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET} $*"; }
error()   { echo -e "${RED}[ERR]${RESET}  $*"; }

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE_MODE=true ;;
    --sync) SYNC_MODE=true ;;
    --help|-h) usage ;;
    *) error "Unknown argument: $arg"; usage ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────
# Prerequisites
# ─────────────────────────────────────────────────────────────────────
check_prerequisites() {
  info "Checking prerequisites..."
  local missing=0

  if ! command -v pi &>/dev/null; then
    error "pi is not installed. See: https://github.com/badlogic/pi-mono"
    missing=1
  else
    success "pi found"
  fi

  if ! command -v node &>/dev/null; then
    error "node is not installed."
    missing=1
  else
    success "node $(node --version) found"
  fi

  if ! command -v npm &>/dev/null; then
    error "npm is not installed."
    missing=1
  else
    success "npm $(npm --version) found"
  fi

  if ! command -v docker &>/dev/null; then
    warn "docker not found. Postgres MCP servers require Docker."
  else
    success "docker found"
  fi

  if ! command -v fd &>/dev/null; then
    warn "fd not found. Some extensions use fd for file search."
    warn "Install with: brew install fd"
  else
    success "fd found"
  fi

  if ! command -v uvx &>/dev/null; then
    warn "uvx not found. jCodeMunch MCP server requires uv/uvx."
    warn "Install with: brew install uv"
  else
    success "uvx found"
  fi

  if [ "$missing" -eq 1 ]; then
    error "Missing required prerequisites. Install them and re-run."
    exit 1
  fi
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Symlink helpers
# ─────────────────────────────────────────────────────────────────────

# Prompt the user to confirm overwriting a target.
# Returns 0 (yes) or 1 (no).
confirm_overwrite() {
  local target="$1"
  if [ "$UPDATE_MODE" = true ]; then
    # In update mode, skip if target is already a symlink pointing to
    # the correct source.
    return 0
  fi
  echo -en "${YELLOW}  $target already exists. Overwrite? [y/N]${RESET} "
  read -r answer
  case "$answer" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Create a symlink from $source to $target.
# If $target already exists, prompt for overwrite (unless update mode
# and the symlink already points to the right place).
link_file() {
  local source="$1"
  local target="$2"

  if [ -L "$target" ]; then
    local current
    current="$(readlink "$target")"
    if [ "$current" = "$source" ]; then
      success "  $(basename "$target") (already linked)"
      return
    fi
    if confirm_overwrite "$target"; then
      ln -sfn "$source" "$target"
      success "  $(basename "$target") (relinked)"
    else
      warn "  $(basename "$target") (skipped)"
    fi
  elif [ -e "$target" ]; then
    if confirm_overwrite "$target"; then
      # Back up existing file
      mv "$target" "${target}.bak"
      warn "  Backed up existing file to ${target}.bak"
      ln -sfn "$source" "$target"
      success "  $(basename "$target") (linked, old file backed up)"
    else
      warn "  $(basename "$target") (skipped)"
    fi
  else
    mkdir -p "$(dirname "$target")"
    ln -sfn "$source" "$target"
    success "  $(basename "$target") (linked)"
  fi
}

# Link a directory: symlink the entire dir.
link_dir() {
  local source="$1"
  local target="$2"
  link_file "$source" "$target"
}

# ─────────────────────────────────────────────────────────────────────
# Config files
# ─────────────────────────────────────────────────────────────────────
install_configs() {
  info "Installing config files to $PI_AGENT_DIR ..."
  mkdir -p "$PI_AGENT_DIR"

  local configs=(
    AGENTS.md
    APPEND_SYSTEM.md
    settings.json
    models.json
    agent-modes.json
    damage-control-rules.yaml
  )

  for cfg in "${configs[@]}"; do
    link_file "$SCRIPT_DIR/$cfg" "$PI_AGENT_DIR/$cfg"
  done
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Extensions
# ─────────────────────────────────────────────────────────────────────
install_extensions() {
  info "Installing extensions to $PI_AGENT_DIR/extensions/ ..."
  mkdir -p "$PI_AGENT_DIR/extensions"

  # Single-file extensions
  for ext in "$SCRIPT_DIR"/extensions/*.ts; do
    local name
    name="$(basename "$ext")"
    link_file "$ext" "$PI_AGENT_DIR/extensions/$name"
  done

  # Directory-based extensions
  for ext_dir in "$SCRIPT_DIR"/extensions/*/; do
    local name
    name="$(basename "$ext_dir")"
    link_dir "$SCRIPT_DIR/extensions/$name" "$PI_AGENT_DIR/extensions/$name"
  done
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Intercepted commands (uv.ts dependency)
# ─────────────────────────────────────────────────────────────────────
install_intercepted_commands() {
  info "Installing intercepted-commands to $PI_AGENT_DIR/intercepted-commands/ ..."
  link_dir "$SCRIPT_DIR/intercepted-commands" "$PI_AGENT_DIR/intercepted-commands"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Skills
# ─────────────────────────────────────────────────────────────────────
install_skills() {
  info "Installing agent-skills to $PI_AGENT_DIR/skills/ ..."
  mkdir -p "$PI_AGENT_DIR/skills"

  for skill_dir in "$SCRIPT_DIR"/agent-skills/*/; do
    local name
    name="$(basename "$skill_dir")"
    link_dir "$SCRIPT_DIR/agent-skills/$name" "$PI_AGENT_DIR/skills/$name"
  done
  echo ""

  info "Installing global-skills to $AGENTS_SKILLS_DIR/ ..."
  mkdir -p "$AGENTS_SKILLS_DIR"

  for skill_dir in "$SCRIPT_DIR"/global-skills/*/; do
    local name
    name="$(basename "$skill_dir")"
    link_dir "$SCRIPT_DIR/global-skills/$name" "$AGENTS_SKILLS_DIR/$name"
  done
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# External skills (installed from source repos via skills CLI)
# ─────────────────────────────────────────────────────────────────────
install_external_skills() {
  info "Installing external skills from source repos..."
  echo ""
  info "These skills are maintained by their original authors and installed"
  info "directly from their repositories. See the README for attribution."
  echo ""

  if ! command -v npx &>/dev/null; then
    error "npx not found. Cannot install external skills."
    return
  fi

  # Anthropic skills: docx, pdf, pptx, xlsx, frontend-design, skill-creator, agent-browser
  info "  Installing from anthropics/skills..."
  npx skills add anthropics/skills -s docx -s pdf -s pptx -s xlsx -s frontend-design -s skill-creator -s agent-browser -g -y 2>&1 || {
    warn "  Some anthropics/skills failed to install"
  }

  # Vercel skills: vercel-react-best-practices, web-design-guidelines, find-skills
  info "  Installing from vercel-labs/skills..."
  npx skills add vercel-labs/skills -s vercel-react-best-practices -s web-design-guidelines -s find-skills -g -y 2>&1 || {
    warn "  Some vercel-labs/skills failed to install"
  }

  # HazAT skills: learn-codebase, self-improve
  info "  Installing from HazAT/pi-config..."
  npx skills add HazAT/pi-config -s learn-codebase -s self-improve -g -y 2>&1 || {
    warn "  Some HazAT/pi-config skills failed to install"
  }

  # manaflow-ai skills: cmux, cmux-and-worktrees, cmux-browser
  info "  Installing from manaflow-ai/cmux..."
  npx skills add manaflow-ai/cmux -s cmux -s cmux-and-worktrees -s cmux-browser -g -y 2>&1 || {
    warn "  Some manaflow-ai/cmux skills failed to install"
  }

  # Vue best practices
  info "  Installing from hyf0/vue-skills..."
  npx skills add hyf0/vue-skills -s vue-best-practices -g -y 2>&1 || {
    warn "  vue-best-practices failed to install"
  }

  # obra skills: systematic-debugging, writing-skills
  info "  Installing from obra/superpowers..."
  npx skills add obra/superpowers -s systematic-debugging -s writing-skills -g -y 2>&1 || {
    warn "  Some obra/superpowers failed to install"
  }

  # Sentry skills: code-simplifier, iterate-pr
  info "  Installing from getsentry/skills..."
  npx skills add getsentry/skills -s code-simplifier -s iterate-pr -g -y 2>&1 || {
    warn "  Some getsentry/skills failed to install"
  }

  # Playwright CLI
  info "  Installing from microsoft/playwright-cli..."
  npx skills add microsoft/playwright-cli -g -y 2>&1 || {
    warn "  microsoft/playwright-cli failed to install"
  }

  # Firecrawl
  info "  Installing from firecrawl/cli..."
  npx skills add firecrawl/cli -s firecrawl -g -y 2>&1 || {
    warn "  firecrawl/cli failed to install"
  }

  # Excalidraw diagram
  info "  Installing from coleam00/excalidraw-diagram-skill..."
  npx skills add coleam00/excalidraw-diagram-skill -g -y 2>&1 || {
    warn "  excalidraw-diagram-skill failed to install"
  }

  echo ""
  success "External skills installation complete"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Secret templates
# ─────────────────────────────────────────────────────────────────────
install_secrets() {
  if [ "$UPDATE_MODE" = true ]; then
    info "Update mode: skipping secret template setup."
    echo ""
    return
  fi

  info "Setting up secret files..."

  # auth.json
  if [ ! -f "$PI_AGENT_DIR/auth.json" ]; then
    cp "$SCRIPT_DIR/auth.json.template" "$PI_AGENT_DIR/auth.json"
    chmod 600 "$PI_AGENT_DIR/auth.json"
    warn "Created $PI_AGENT_DIR/auth.json from template."
    warn "Edit it to add your API keys:"
    echo "    \$EDITOR $PI_AGENT_DIR/auth.json"
  else
    success "auth.json already exists (not overwritten)"
  fi

  # mcp.json
  if [ ! -f "$PI_AGENT_DIR/mcp.json" ]; then
    cp "$SCRIPT_DIR/mcp.json.template" "$PI_AGENT_DIR/mcp.json"
    chmod 600 "$PI_AGENT_DIR/mcp.json"
    warn "Created $PI_AGENT_DIR/mcp.json from template."
    warn "Edit it to add your database URIs and credentials:"
    echo "    \$EDITOR $PI_AGENT_DIR/mcp.json"
  else
    success "mcp.json already exists (not overwritten)"
  fi

  # exa-search .env
  local exa_env="$SCRIPT_DIR/agent-skills/exa-search/.env"
  local exa_example="$SCRIPT_DIR/agent-skills/exa-search/.env.example"
  if [ ! -f "$exa_env" ] && [ -f "$exa_example" ]; then
    cp "$exa_example" "$exa_env"
    warn "Created exa-search .env from .env.example."
    warn "Edit it to add your Exa API key:"
    echo "    \$EDITOR $exa_env"
  else
    success "exa-search .env already exists (not overwritten)"
  fi

  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Extension dependencies (npm install)
# ─────────────────────────────────────────────────────────────────────
install_extension_deps() {
  info "Installing extension dependencies..."

  for pkg_dir in "$SCRIPT_DIR"/extensions/*/; do
    if [ -f "$pkg_dir/package.json" ]; then
      local name
      name="$(basename "$pkg_dir")"
      info "  npm install in extensions/$name ..."
      (cd "$pkg_dir" && npm install --silent 2>&1) || {
        error "  npm install failed in extensions/$name"
      }
      success "  extensions/$name dependencies installed"
    fi
  done
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Pi packages
# ─────────────────────────────────────────────────────────────────────
install_pi_packages() {
  info "Installing pi packages..."

  pi install npm:@danchamorro/pi-agent-modes 2>&1 || {
    warn "Failed to install pi-agent-modes (may already be installed)"
  }
  pi install npm:@danchamorro/pi-prompt-enhancer 2>&1 || {
    warn "Failed to install pi-prompt-enhancer (may already be installed)"
  }

  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Dangling symlink check
# ─────────────────────────────────────────────────────────────────────
check_dangling_symlinks() {
  info "Checking for dangling symlinks..."
  local found=0

  for target_dir in "$PI_AGENT_DIR/extensions" "$PI_AGENT_DIR/skills" "$AGENTS_SKILLS_DIR"; do
    if [ -d "$target_dir" ]; then
      while IFS= read -r link; do
        if [ -n "$link" ]; then
          warn "  Dangling symlink: $link -> $(readlink "$link")"
          found=1
        fi
      done < <(find "$target_dir" -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null)
    fi
  done

  if [ "$found" -eq 0 ]; then
    success "No dangling symlinks found"
  fi
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Sync: absorb new extensions/skills from pi into the repo
# ─────────────────────────────────────────────────────────────────────

# External skills installed by the skills CLI. These are skipped during
# sync because they are not ours to maintain.
EXTERNAL_SKILLS=(
  agent-browser code-simplifier cmux cmux-and-worktrees cmux-browser
  cmux-debug-windows cmux-markdown docx excalidraw-diagram firecrawl
  find-skills frontend-design iterate-pr learn-codebase pdf
  playwright-cli pptx self-improve skill-creator systematic-debugging
  vercel-react-best-practices vue-best-practices web-design-guidelines
  writing-skills xlsx
)

is_external_skill() {
  local name="$1"
  for ext in "${EXTERNAL_SKILLS[@]}"; do
    [ "$name" = "$ext" ] && return 0
  done
  return 1
}

sync_extensions() {
  info "Scanning for new extensions not yet in the repo..."
  local found=0

  # Single-file extensions (.ts files)
  for ext_file in "$PI_AGENT_DIR"/extensions/*.ts; do
    [ -f "$ext_file" ] || continue
    local name
    name="$(basename "$ext_file")"

    # Skip if it's already a symlink (managed by us)
    [ -L "$ext_file" ] && continue

    found=1
    echo -en "${YELLOW}  Found new extension: $name${RESET}"
    echo ""
    echo -en "${CYAN}  Move to repo and symlink back? [y/N]${RESET} "
    read -r answer
    case "$answer" in
      [yY]|[yY][eE][sS])
        cp "$ext_file" "$SCRIPT_DIR/extensions/$name"
        ln -sfn "$SCRIPT_DIR/extensions/$name" "$ext_file"
        success "  Absorbed $name into repo"
        ;;
      *)
        warn "  Skipped $name"
        ;;
    esac
  done

  # Directory-based extensions
  for ext_dir in "$PI_AGENT_DIR"/extensions/*/; do
    [ -d "$ext_dir" ] || continue
    local name
    name="$(basename "$ext_dir")"

    # Skip if it's already a symlink (managed by us)
    [ -L "${ext_dir%/}" ] && continue

    # Skip node_modules and other non-extension dirs
    [ "$name" = "node_modules" ] && continue

    found=1
    echo -en "${YELLOW}  Found new directory extension: $name/${RESET}"
    echo ""
    echo -en "${CYAN}  Move to repo and symlink back? [y/N]${RESET} "
    read -r answer
    case "$answer" in
      [yY]|[yY][eE][sS])
        cp -R "$ext_dir" "$SCRIPT_DIR/extensions/$name"
        rm -rf "$ext_dir"
        ln -sfn "$SCRIPT_DIR/extensions/$name" "${ext_dir%/}"
        success "  Absorbed $name/ into repo"
        ;;
      *)
        warn "  Skipped $name/"
        ;;
    esac
  done

  if [ "$found" -eq 0 ]; then
    success "No new extensions found"
  fi
  echo ""
}

sync_agent_skills() {
  info "Scanning for new agent skills not yet in the repo..."
  local found=0

  for skill_dir in "$PI_AGENT_DIR"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    local name
    name="$(basename "$skill_dir")"

    # Skip symlinks (managed by us or by the skills CLI)
    [ -L "${skill_dir%/}" ] && continue

    # Skip external skills
    is_external_skill "$name" && continue

    found=1
    echo -en "${YELLOW}  Found new agent skill: $name/${RESET}"
    echo ""
    echo -en "${CYAN}  Move to repo (agent-skills/) and symlink back? [y/N]${RESET} "
    read -r answer
    case "$answer" in
      [yY]|[yY][eE][sS])
        cp -R "$skill_dir" "$SCRIPT_DIR/agent-skills/$name"
        rm -rf "$skill_dir"
        ln -sfn "$SCRIPT_DIR/agent-skills/$name" "${skill_dir%/}"
        success "  Absorbed $name/ into repo (agent-skills)"
        ;;
      *)
        warn "  Skipped $name/"
        ;;
    esac
  done

  if [ "$found" -eq 0 ]; then
    success "No new agent skills found"
  fi
  echo ""
}

run_sync() {
  echo ""
  echo -e "${BOLD}pi-toolkit sync${RESET}"
  echo -e "${CYAN}Finding new extensions and skills to absorb into the repo${RESET}"
  echo ""

  sync_extensions
  sync_agent_skills

  echo -e "${GREEN}${BOLD}Sync complete!${RESET}"
  echo ""
  echo "Next steps:"
  echo "  1. Review the absorbed files in dotfiles/"
  echo "  2. Update dotfiles/README.md if needed"
  echo "  3. Commit the changes"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
main() {
  # Sync mode: run sync and exit
  if [ "$SYNC_MODE" = true ]; then
    run_sync
    return
  fi

  echo ""
  echo -e "${BOLD}pi-toolkit dotfiles installer${RESET}"
  if [ "$UPDATE_MODE" = true ]; then
    echo -e "${CYAN}Running in update mode${RESET}"
  fi
  echo ""

  check_prerequisites
  install_configs
  install_extensions
  install_intercepted_commands
  install_skills
  install_external_skills
  install_secrets
  install_extension_deps
  install_pi_packages
  check_dangling_symlinks

  echo -e "${GREEN}${BOLD}Installation complete!${RESET}"
  echo ""
  if [ "$UPDATE_MODE" = false ]; then
    echo "Next steps:"
    echo "  1. Edit $PI_AGENT_DIR/auth.json with your API keys"
    echo "  2. Edit $PI_AGENT_DIR/mcp.json with your database URIs"
    echo "  3. See dotfiles/SETUP.md for detailed configuration guide"
  fi
  echo ""
}

main "$@"

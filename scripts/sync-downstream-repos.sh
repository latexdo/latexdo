#!/usr/bin/env sh
set -eu

SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$SOURCE_DIR")"

EDITOR_REPO="${LATEXDO_EDITOR_REPO:-$PARENT_DIR/editor.latexdo.org}"
WEBSITE_REPO="${LATEXDO_WEBSITE_REPO:-$PARENT_DIR/latexdo.org}"
CLI_REPO="${LATEXDO_CLI_REPO:-$PARENT_DIR/latexdo-cli}"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'sync-downstream: %s\n' "$*" >&2
  exit 1
}

require_dir() {
  [ -d "$1" ] || die "$2 not found at $1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

sync_cli_repo() {
  require_dir "$CLI_REPO" "CLI repo"

  log "Syncing CLI repo: $CLI_REPO"
  rsync -a --delete \
    --exclude ".git/" \
    "$SOURCE_DIR/cli/" \
    "$CLI_REPO/"

  cp "$SOURCE_DIR/LICENSE" "$CLI_REPO/LICENSE"
  chmod 0755 "$CLI_REPO/bin/latexdo" "$CLI_REPO/install.sh"
}

sync_website_repo() {
  require_dir "$WEBSITE_REPO" "website repo"

  log "Preparing website assets"
  mkdir -p "$SOURCE_DIR/website/bin"
  cp "$SOURCE_DIR/cli/install.sh" "$SOURCE_DIR/website/install.sh"
  cp "$SOURCE_DIR/cli/bin/latexdo" "$SOURCE_DIR/website/bin/latexdo"
  chmod 0755 "$SOURCE_DIR/website/install.sh" "$SOURCE_DIR/website/bin/latexdo"

  npm --prefix "$SOURCE_DIR/website" ci
  npm --prefix "$SOURCE_DIR/website" run build
  (
    cd "$SOURCE_DIR"
    npx prettier --write website/assets/site.js website/index.html website/style.css
  )

  log "Syncing website repo: $WEBSITE_REPO"
  rsync -a --delete \
    --exclude ".git/" \
    --exclude "node_modules/" \
    --exclude ".nojekyll" \
    --exclude "README.md" \
    --exclude "LICENSE" \
    --exclude "wrangler.jsonc" \
    "$SOURCE_DIR/website/" \
    "$WEBSITE_REPO/"
}

sync_editor_repo() {
  require_dir "$EDITOR_REPO" "editor repo"

  log "Building hosted editor frontend: $EDITOR_REPO"
  LATEXDO_FRONTEND_REPO="$SOURCE_DIR" npm --prefix "$EDITOR_REPO" run build:frontend
}

require_cmd rsync
require_cmd npm

sync_cli_repo
sync_website_repo
sync_editor_repo

log "Downstream repos are synced."

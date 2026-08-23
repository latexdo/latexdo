#!/usr/bin/env sh
set -eu

SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$SOURCE_DIR")"

EDITOR_REPO="${LATEXDO_EDITOR_REPO:-$PARENT_DIR/editor.latexdo.org}"
CLI_REPO="${LATEXDO_CLI_REPO:-$PARENT_DIR/cli.latexdo.org}"

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
  mkdir -p "$CLI_REPO/bin"
  cp "$SOURCE_DIR/cli/README.md" "$SOURCE_DIR/cli/package.json" \
    "$SOURCE_DIR/cli/install.sh" "$CLI_REPO/"
  cp "$SOURCE_DIR/cli/bin/latexdo" "$CLI_REPO/bin/latexdo"
  cp "$SOURCE_DIR/LICENSE" "$CLI_REPO/LICENSE"
  chmod 0755 "$CLI_REPO/bin/latexdo" "$CLI_REPO/install.sh"
}

sync_editor_repo() {
  require_dir "$EDITOR_REPO" "editor repo"

  log "Building hosted editor frontend: $EDITOR_REPO"
  LATEXDO_FRONTEND_REPO="$SOURCE_DIR" npm --prefix "$EDITOR_REPO" run build:frontend
}

require_cmd npm

sync_cli_repo
sync_editor_repo

log "Downstream repos are synced."

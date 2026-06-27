#!/usr/bin/env sh
set -eu

CLI_URL="${LATEXDO_CLI_URL:-https://latexdo.org/bin/latexdo}"
INSTALL_DIR="${LATEXDO_BIN_DIR:-$HOME/.local/bin}"
TARGET="$INSTALL_DIR/latexdo"

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'latexdo install: %s\n' "$*" >&2
}

die() {
  warn "$*"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

download() {
  url="$1"
  output="$2"

  if command_exists curl; then
    curl -fsSL "$url" -o "$output"
    return
  fi

  if command_exists wget; then
    wget -qO "$output" "$url"
    return
  fi

  die "curl or wget is required to download LatexDo CLI."
}

make_temp_file() {
  if command_exists mktemp; then
    mktemp "${TMPDIR:-/tmp}/latexdo.XXXXXX"
  else
    printf '%s\n' "${TMPDIR:-/tmp}/latexdo.$$"
  fi
}

mkdir -p "$INSTALL_DIR"
tmp_file="$(make_temp_file)"
trap 'rm -f "$tmp_file"' EXIT INT TERM

log "Downloading LatexDo CLI"
download "$CLI_URL" "$tmp_file"

chmod 0755 "$tmp_file"
mv "$tmp_file" "$TARGET"
trap - EXIT INT TERM

log "Installed latexdo to $TARGET"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    warn "$INSTALL_DIR is not in PATH."
    warn "Add this to your shell profile: export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

if [ "${LATEXDO_SKIP_BOOTSTRAP:-0}" != "1" ]; then
  log "Bootstrapping LatexDo source and npm dependencies"
  "$TARGET" update
fi

log "Run: latexdo"

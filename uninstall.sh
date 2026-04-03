#!/usr/bin/env bash
#
# KumaCode Uninstaller
# Removes kumacode app, launcher, and config (optional).
#
set -euo pipefail

INSTALL_DIR="${KUMACODE_HOME:-$HOME/.kumacode/app}"
BIN_DIR="${KUMACODE_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="$HOME/.kumacode"
LAUNCHER="$BIN_DIR/kumacode"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}${BOLD}[kumacode]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}${BOLD}[kumacode]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}${BOLD}[kumacode]${RESET} %s\n" "$*"; }

# --- Remove launcher ---
if [ -f "$LAUNCHER" ]; then
  rm "$LAUNCHER"
  ok "Removed launcher: $LAUNCHER"
else
  info "No launcher found at $LAUNCHER"
fi

# --- Remove app directory ---
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  ok "Removed app: $INSTALL_DIR"
else
  info "No app directory at $INSTALL_DIR"
fi

# --- Ask about config ---
if [ -d "$CONFIG_DIR" ]; then
  # Check if there's anything left besides the app dir
  remaining=$(find "$CONFIG_DIR" -mindepth 1 -maxdepth 1 -not -name "app" 2>/dev/null | head -5)
  if [ -n "$remaining" ]; then
    echo ""
    warn "Config directory still has data:"
    echo "  $CONFIG_DIR"
    echo ""
    echo "  Contains: settings.json, sessions.db, skills/, etc."
    echo ""
    printf "  Remove config too? [y/N] "
    read -r answer
    if [[ "$answer" =~ ^[Yy] ]]; then
      rm -rf "$CONFIG_DIR"
      ok "Removed config: $CONFIG_DIR"
    else
      info "Kept config at $CONFIG_DIR"
    fi
  else
    # Only app dir was there, already removed — clean up empty dir
    rmdir "$CONFIG_DIR" 2>/dev/null && ok "Removed empty config dir" || true
  fi
fi

echo ""
ok "KumaCode uninstalled."
echo ""
info "Note: Bun was not removed. To remove it: rm -rf ~/.bun"

#!/bin/bash
set -e

INSTALL_DIR="$HOME/.polkadot"
REPO="paritytech/playground-cli"
# The command users invoke, plus a short alias. Both resolve to the same binary.
CMD="playground"
ALIAS="pg"
# Release artifacts are still published as `dot-<os>-<arch>` — keep the asset
# prefix in sync with .github/workflows/release.yml. The downloaded file is
# saved locally under $CMD, so the old `dot` command name is gone.
ASSET_PREFIX="dot"

# 1) Detect platform
OS=$(uname -s); case "$OS" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "Unsupported OS: $OS"; exit 1;; esac
ARCH=$(uname -m); case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "Unsupported arch: $ARCH"; exit 1;; esac
ASSET="$ASSET_PREFIX-$OS-$ARCH"

# 2) Resolve release tag
#
#   Use VERSION to install a specific tag. Otherwise, prefer GitHub's no-body
#   `releases/latest` redirect. This avoids api.github.com quota while keeping
#   "latest" tied to the same GitHub release source used for the binary
#   download. jsDelivr is CDN-backed and can lag a freshly published release,
#   so keep it as fallback only.
if [ -n "$VERSION" ]; then
  TAG="$VERSION"
else
  TAG=$(curl -fsSI -H "Cache-Control: no-cache" -H "Pragma: no-cache" "https://github.com/$REPO/releases/latest" \
        | sed -n 's|^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]:[[:space:]]*.*/tag/\(.*\)$|\1|p' \
        | tr -d '\r' | head -n1) || true
  if [ -z "$TAG" ]; then
    TAG=$(curl -fsSL "https://data.jsdelivr.com/v1/packages/gh/$REPO/resolved" \
          | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n1) || true
  fi
  case "$TAG" in v*|'') ;; *) TAG="v$TAG" ;; esac
fi
[ -z "$TAG" ] && echo "Could not determine latest release" && exit 1

# 3) Install binary
spin() { while true; do for c in '|' '/' '-' '\'; do printf "\r%s %s" "$1" "$c"; sleep 0.1; done; done; }
spin "Installing $CMD ($OS/$ARCH) $TAG" &
SPIN_PID=$!
trap "kill $SPIN_PID 2>/dev/null" EXIT

mkdir -p "$INSTALL_DIR/bin" "$HOME/.local/bin"
curl -fsSL "https://github.com/$REPO/releases/download/$TAG/$ASSET" -o "$INSTALL_DIR/bin/$CMD"
chmod +x "$INSTALL_DIR/bin/$CMD"
if [ "$OS" = "darwin" ]; then
  codesign --sign - --force "$INSTALL_DIR/bin/$CMD" 2>/dev/null || true
  xattr -c "$INSTALL_DIR/bin/$CMD" 2>/dev/null || true
fi
# Expose both the full command and its short alias from both bin dirs on PATH.
ln -sf "$INSTALL_DIR/bin/$CMD" "$INSTALL_DIR/bin/$ALIAS"
ln -sf "$INSTALL_DIR/bin/$CMD" "$HOME/.local/bin/$CMD"
ln -sf "$INSTALL_DIR/bin/$CMD" "$HOME/.local/bin/$ALIAS"
# Remove the legacy `dot` binary/symlink from earlier installs so it stops
# resolving on PATH — the command is now `playground` (or `pg`).
rm -f "$INSTALL_DIR/bin/dot" "$HOME/.local/bin/dot"

kill $SPIN_PID 2>/dev/null; wait $SPIN_PID 2>/dev/null || true; trap - EXIT
printf "\rInstalled %s (%s/%s) %s   \n" "$CMD" "$OS" "$ARCH" "$TAG"

# 4) Add to PATH
append_once() {
  local file="$1" line="$2"
  grep -Fqx "$line" "$file" 2>/dev/null || printf "\n%s\n" "$line" >> "$file"
}
if command -v bash >/dev/null 2>&1; then
  append_once "$HOME/.bashrc" 'export PATH="$HOME/.polkadot/bin:$HOME/.local/bin:$PATH"'
  append_once "$HOME/.bash_profile" '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"'
fi
if command -v zsh >/dev/null 2>&1; then
  append_once "$HOME/.zshrc" 'export PATH="$HOME/.polkadot/bin:$HOME/.local/bin:$PATH"'
fi
if command -v fish >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/fish"
  append_once "$HOME/.config/fish/config.fish" 'fish_add_path $HOME/.polkadot/bin $HOME/.local/bin'
fi

export PATH="$INSTALL_DIR/bin:$HOME/.local/bin:$PATH"

echo ""
echo -e "$CMD is ready! Setting up dependencies…"
echo ""
if ! "$INSTALL_DIR/bin/$CMD" init --yes; then
  INIT_EXIT=$?
  echo -e "\n\033[33mDependency setup failed. Run \033[1m$CMD init\033[0;33m (or \033[1m$ALIAS init\033[0;33m) when ready.\033[0m" >&2
  exit "$INIT_EXIT"
fi

# Final "what to run next" prompt, styled to match the yellow rounded-border
# Callout the TUI uses for phone-signing notifications (see
# src/utils/ui/theme/Callout.tsx). Mirrored in bash so it shows the moment the
# curl install finishes.
Y='\033[33m'; B='\033[1m'; R='\033[0m'
echo ""
echo -e "${Y}╭─ ${B}next step${R}${Y} ──────────────────────────────╮${R}"
echo -e "${Y}│${R} Run ${B}$CMD init${R} or ${B}$ALIAS init${R} to log in ${Y}│${R}"
echo -e "${Y}│${R} with the Polkadot mobile app.            ${Y}│${R}"
echo -e "${Y}│${R} Both commands work the same.             ${Y}│${R}"
echo -e "${Y}╰──────────────────────────────────────────╯${R}"

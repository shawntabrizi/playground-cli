#!/bin/bash
set -e

INSTALL_DIR="$HOME/.polkadot"
REPO="paritytech/playground-cli"
BIN="dot"

# 1) Detect platform
OS=$(uname -s); case "$OS" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "Unsupported OS: $OS"; exit 1;; esac
ARCH=$(uname -m); case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "Unsupported arch: $ARCH"; exit 1;; esac
ASSET="$BIN-$OS-$ARCH"

# 2) Resolve release tag
#   - fetch latest if available
#   - install specific version if `VERSION` is provided
if [ -n "$VERSION" ]; then
  TAG="$VERSION"
else
  TAG=$(curl -fsSI "https://github.com/$REPO/releases/latest" \
        | sed -n 's|^location:.*/tag/\(.*\)$|\1|p' | tr -d '\r' | head -n1) || true
  if [ -z "$TAG" ]; then
    TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" \
          | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1) || true
  fi
fi
[ -z "$TAG" ] && echo "Could not determine latest release" && exit 1

# 3) Install binary
mkdir -p "$INSTALL_DIR/bin" "$HOME/.local/bin"
curl -fsSL "https://github.com/$REPO/releases/download/$TAG/$ASSET" -o "$INSTALL_DIR/bin/$BIN"
chmod +x "$INSTALL_DIR/bin/$BIN"
if [ "$OS" = "darwin" ]; then
  codesign --sign - --force "$INSTALL_DIR/bin/$BIN" 2>/dev/null || true
  xattr -c "$INSTALL_DIR/bin/$BIN" 2>/dev/null || true
fi
ln -sf "$INSTALL_DIR/bin/$BIN" "$HOME/.local/bin/$BIN"

echo "Installed $BIN ($OS/$ARCH) from $TAG -> $INSTALL_DIR/bin/$BIN"

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
echo -e "dot is ready! Running: \033[1mdot init\033[0m"
echo ""
"$INSTALL_DIR/bin/$BIN" init

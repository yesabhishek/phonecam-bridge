#!/bin/sh
# Installs PhoneCam from GitHub.
#
#   curl -fsSL https://raw.githubusercontent.com/yesabhishek/phonecam-bridge/main/install.sh | sh
#
# Re-running it updates an existing install.
set -eu

REPO="${PHONECAM_REPO:-https://github.com/yesabhishek/phonecam-bridge.git}"
DIR="${PHONECAM_DIR:-$HOME/.local/share/phonecam}"
BIN_DIR="${PHONECAM_BIN_DIR:-$HOME/.local/bin}"

fail() {
  echo "phonecam install: $*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required."
command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is required (https://nodejs.org)."
command -v npm >/dev/null 2>&1 || fail "npm is required (it ships with Node.js)."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  fail "Node.js 20 or newer is required (found $(node --version))."

if [ -d "$DIR/.git" ]; then
  echo "Updating PhoneCam in $DIR"
  git -C "$DIR" pull --ff-only --quiet
else
  echo "Downloading PhoneCam to $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet --depth 1 "$REPO" "$DIR"
fi

(cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chmod +x "$DIR/bin/phonecam.js"
mkdir -p "$BIN_DIR"
ln -sf "$DIR/bin/phonecam.js" "$BIN_DIR/phonecam"
echo "Installed: $BIN_DIR/phonecam"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to your PATH, e.g.: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile" ;;
esac

if [ "$(uname -s)" = "Linux" ]; then
  echo
  echo "Running one-time camera setup (asks for your password once)..."
  # When piped from curl, stdin is the script; read prompts from the terminal.
  if (exec </dev/tty) 2>/dev/null; then
    "$BIN_DIR/phonecam" setup </dev/tty
  else
    "$BIN_DIR/phonecam" setup
  fi
else
  echo
  "$BIN_DIR/phonecam" setup || true
fi

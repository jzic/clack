#!/bin/bash
# One-command setup for a fresh clone: install deps, build the UI, and generate
# the Clack.app launcher. Invoked by `npm run setup`.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ Clack setup"

# ---- preflight: hard-check the real blockers before we touch npm ----
# ✗ = must fix (we stop). ! = works without it, but you'll miss something.
# Kept array-free so it's safe under macOS's stock bash 3.2 + `set -u`.
echo "▸ Preflight — checking prerequisites…"
FAIL=0

# Node.js (required) — build + runtime.
if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js not installed (need v22+)."
  echo "      nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22"
  echo "      or:   https://nodejs.org"
  FAIL=1
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "  ! Node $(node -v) found; v22+ recommended:  nvm install 22 && nvm use 22"
  fi
fi

# Xcode Command Line Tools (required) — node-pty is a native module that compiles
# on install; without a C++ toolchain `npm install` dies with a cryptic node-gyp error.
if ! xcode-select -p >/dev/null 2>&1; then
  echo "  ✗ Xcode Command Line Tools missing — node-pty can't compile."
  echo "      Fix:  xcode-select --install    (then re-run: npm run setup)"
  FAIL=1
fi

# tmux (required) — sessions live inside it so they survive restarts. Auto-installed
# just below if Homebrew is present; only a hard blocker when brew is also missing.
if ! command -v tmux >/dev/null 2>&1 && ! command -v brew >/dev/null 2>&1; then
  echo "  ✗ tmux missing and Homebrew unavailable to install it."
  echo "      Homebrew:  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  echo "      then:      brew install tmux"
  FAIL=1
fi

# Google Chrome (warn) — the chromeless launcher window needs it; the server itself
# is happy in any browser at the URL below.
[ -d "/Applications/Google Chrome.app" ] || echo "  ! Google Chrome not found — the chromeless Clack.app window needs it (any browser can open http://127.0.0.1:8127).  https://www.google.com/chrome/"

# Claude Code (warn) — Claude channels autostart 'claude'; scratch terminals work without it.
command -v claude >/dev/null 2>&1 || echo "  ! 'claude' CLI not on PATH — Claude channels can't start; scratch terminals still work.  https://claude.com/product/claude-code"

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "✗ Preflight failed — fix the ✗ item(s) above, then re-run:  npm run setup"
  exit 1
fi
echo "  ✓ prerequisites look good"

# tmux missing but brew present → install it now (preflight let this case through).
if ! command -v tmux >/dev/null 2>&1; then
  echo "▸ Installing tmux (sessions run inside it so they survive restarts)…"
  brew install tmux || echo "  ! Could not install tmux automatically. Run: brew install tmux"
fi

echo "▸ Installing dependencies…"
npm install

echo "▸ Building the web UI…"
npm run build

if [ -e "$HOME/Applications/Clack.app" ]; then
  echo "▸ Clack.app launcher already present — leaving it as-is."
  echo "  (to rebuild: Trash it in Finder, then re-run — this avoids the macOS App Management prompt)"
else
  echo "▸ Building the Clack.app launcher…"
  bash scripts/make-launcher.sh
fi

cat <<'DONE'

✔ Clack is ready.

  Start it:   npm start          (or double-click ~/Applications/Clack.app)
  Open:       http://127.0.0.1:8127

  Recommended, one-time each:
   • Attention badges — wire in the Claude Code hooks   → docs/claude-hooks.md
   • Keep the server alive across logins/crashes        → npm run launchd:install
DONE

#!/bin/bash
# Pull the latest Clack and apply it. Safe to run anytime: your terminal
# sessions live in tmux, so restarting the server here is lossless.
#
# Steps: git pull → npm install → build the UI → restart the server.
# Kept array-free for macOS's stock bash 3.2.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ Updating Clack"

# 1. Pull latest — fast-forward only, so a colleague's clone can't accidentally
#    create a merge commit. Local edits that diverge stop here with a clear error.
if [ -d .git ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "  ! You have uncommitted local changes — stash or commit them first, then re-run."
    echo "      git stash        # set them aside"
    exit 1
  fi
  echo "▸ Pulling latest…"
  if ! git pull --ff-only; then
    echo "  ✗ git pull could not fast-forward (your branch has diverged)."
    echo "      Reconcile manually, then re-run: npm run update"
    exit 1
  fi
else
  echo "  ! Not a git checkout — skipping pull (nothing to update from)."
fi

# 2. Dependencies (idempotent; rebuilds node-pty if it changed).
echo "▸ Installing dependencies…"
npm install

# 3. Rebuild the UI — the server serves web/dist, so without this a pull changes
#    source but the running window keeps serving the old bundle.
echo "▸ Building the web UI…"
npm run build

# 4. Restart the server so new server-side code takes effect. tmux keeps every
#    session alive across the restart, so this is free.
if launchctl list 2>/dev/null | grep -q com.clack.server; then
  echo "▸ Restarting clack-server (launchd)… sessions survive via tmux."
  launchctl kickstart -k "gui/$(id -u)/com.clack.server"
  echo "  ✓ restarted."
else
  echo "  ! clack-server isn't managed by launchd — restart it yourself:"
  echo "      stop your 'npm start' (Ctrl+C) and run it again (tmux keeps sessions alive)."
  echo "      or install the agent once:  npm run launchd:install"
fi

cat <<'DONE'

✔ Clack updated.

  Reload the window (⌘R) to load the new UI — it replays every terminal
  losslessly, so nothing in your sessions is interrupted.
DONE

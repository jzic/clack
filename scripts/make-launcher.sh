#!/bin/bash
# Build a double-clickable Clack.app launcher: it ensures clack-server is running
# (starts it if not), then opens Clack in a chromeless Chrome app-mode window.
#
#   ./scripts/make-launcher.sh [--force] [target.app]   (default: ~/Applications/Clack.app)
#
# Re-run this if you move the repo or upgrade Node — the paths are baked in.
# If the bundle already exists we refuse to overwrite it: modifying an existing
# .app trips macOS "App Management" and prompts to let node update/delete apps.
# Trash the old bundle in Finder first, or pass --force (needs that permission).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8127

FORCE=0
APP=""
for a in "$@"; do
  case "$a" in
    -f | --force) FORCE=1 ;;
    *) APP="$a" ;;
  esac
done
APP="${APP:-$HOME/Applications/Clack.app}"

# Bake the Node bin dir in: a GUI-launched .app gets a minimal PATH and won't
# find nvm's node otherwise.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not on PATH; run this from a shell where \`node\` works." >&2
  exit 1
fi
NODE_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"

echo "repo:   $REPO"
echo "node:   $NODE_DIR"
echo "target: $APP"

if [ -e "$APP" ]; then
  if [ "$FORCE" = "1" ]; then
    echo "note: --force — removing the existing bundle (macOS may prompt for App Management)"
    rm -rf "$APP"
  else
    cat >&2 <<MSG
error: $APP already exists — refusing to modify it in place.

macOS "App Management" protects existing app bundles, so rebuilding one makes
macOS ask you to let 'node' update or delete other applications. That's a broad
grant for a shared interpreter, and you don't need it just to refresh a launcher.

To rebuild cleanly:
  • drag "$APP" to the Trash in Finder, then re-run this script, or
  • re-run with --force if you've already granted node App Management.
MSG
    exit 1
  fi
fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# --- icon (optional; needs python3 + Pillow) ---
ICON_PLIST=""
if python3 -c "import PIL" >/dev/null 2>&1; then
  python3 "$REPO/scripts/make-icon.py" "$REPO/scripts/Clack.iconset"
  iconutil -c icns "$REPO/scripts/Clack.iconset" -o "$APP/Contents/Resources/Clack.icns"
  rm -rf "$REPO/scripts/Clack.iconset"
  ICON_PLIST='  <key>CFBundleIconFile</key><string>Clack</string>'
  echo "icon:   built Clack.icns"
else
  echo "icon:   skipped (Pillow not installed) — app gets a generic icon"
fi

# --- Info.plist ---
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Clack</string>
  <key>CFBundleDisplayName</key><string>Clack</string>
  <key>CFBundleIdentifier</key><string>com.clack.launcher</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Clack</string>
$ICON_PLIST
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# --- launcher executable (baked REPO/NODE_DIR; runtime vars escaped) ---
cat > "$APP/Contents/MacOS/Clack" <<LAUNCH
#!/bin/bash
# Ensure clack-server is up, then open the chromeless window.
export PATH="$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "\$HOME/.clack"
if ! curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
  ( cd "$REPO" && nohup npm start >>"\$HOME/.clack/server.log" 2>&1 & )
  for _ in \$(seq 1 30); do
    curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1 && break
    sleep 0.5
  done
fi
exec open -na "Google Chrome" --args --app=http://127.0.0.1:$PORT
LAUNCH
chmod +x "$APP/Contents/MacOS/Clack"

touch "$APP"  # nudge LaunchServices to pick up the new bundle/icon
echo "built:  $APP"

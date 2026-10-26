// Safely merge (or remove) Clack's Claude Code hooks in ~/.claude/settings.json.
//
//   node scripts/install-hooks.mjs install     (or: npm run hooks:install)
//   node scripts/install-hooks.mjs uninstall
//
// Global hooks are the clean way to get precise, real-time status for EVERY
// Clack channel — including projects you haven't opened yet. The command is
// guarded on $CLACK_CHANNEL_ID, so it is completely inert for any Claude session
// that Clack did not spawn (your normal terminal usage is unaffected). This
// script MERGES: it preserves every hook you already have and is idempotent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const BACKUP = SETTINGS + '.clack-backup';
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];
const MARKER = 'CLACK_CHANNEL_ID';
const COMMAND =
  '[ -n "$CLACK_CHANNEL_ID" ] && curl -s -m 1 -X POST ' +
  '"http://127.0.0.1:${CLACK_PORT:-8127}/api/hook?channel=$CLACK_CHANNEL_ID" ' +
  "-H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1; exit 0";

function load() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Could not parse ${SETTINGS}: ${err.message}`);
  }
}

function save(settings) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS) && !fs.existsSync(BACKUP)) fs.copyFileSync(SETTINGS, BACKUP);
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

const hasClack = (groups) =>
  Array.isArray(groups) && groups.some((g) => g?.hooks?.some((h) => typeof h?.command === 'string' && h.command.includes(MARKER)));

function install() {
  const settings = load();
  settings.hooks ??= {};
  let added = 0;
  for (const event of EVENTS) {
    const groups = (settings.hooks[event] ??= []);
    if (hasClack(groups)) continue; // already wired — leave it
    groups.push({ hooks: [{ type: 'command', command: COMMAND }] });
    added++;
  }
  if (added === 0) {
    console.log('Clack hooks already installed — nothing to do.');
    return;
  }
  save(settings);
  console.log(`Installed Clack hooks for ${added} event(s). Backup at ${BACKUP}.`);
  console.log('New Clack channels get precise real-time status; restart any Claude session already running in a channel.');
}

function uninstall() {
  const settings = load();
  let removed = 0;
  for (const event of EVENTS) {
    const groups = settings.hooks?.[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => !g?.hooks?.some((h) => h?.command?.includes(MARKER)));
    removed += groups.length - kept.length;
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (removed === 0) {
    console.log('No Clack hooks found — nothing to remove.');
    return;
  }
  save(settings);
  console.log(`Removed ${removed} Clack hook entr(ies). Your other hooks are untouched.`);
}

const cmd = process.argv[2];
if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else {
  console.log('usage: node scripts/install-hooks.mjs <install|uninstall>');
  process.exit(1);
}

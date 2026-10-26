// Durability layer: each channel's shell runs inside its own tmux session on a
// dedicated, isolated tmux server (socket "clack"). The shell (and any Claude
// session in it) survives clack-server dying — on restart we re-attach to the
// living session instead of respawning. tmux is configured to be invisible: no
// status bar, no prefix key (so Ctrl+B still reaches Claude Code), title
// pass-through so channel subtitles keep working.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const TMUX_SOCKET = 'clack';
const CONF_PATH = path.join(os.homedir(), '.clack', 'clack.tmux.conf');

const CONF = `# Clack — generated. Makes tmux invisible and sessions durable.
set -g status off
set -g prefix None
unbind C-b
set -sg escape-time 0
set -g destroy-unattached off
set -g mouse off
setw -g aggressive-resize on
set -g history-limit 50000
set -g default-terminal "xterm-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
set -g default-command "/bin/zsh -l"
# forward the app's window title out to Clack (drives channel subtitles)
set -g allow-rename on
set -g set-titles on
set -g set-titles-string "#{pane_title}"
`;

/** Is tmux available on PATH? */
export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function ensureTmuxConf(): string {
  fs.mkdirSync(path.dirname(CONF_PATH), { recursive: true });
  fs.writeFileSync(CONF_PATH, CONF);
  return CONF_PATH;
}

export function confPath(): string {
  return CONF_PATH;
}

export function sessionName(channelId: string): string {
  return `clack-${channelId}`;
}

export function tmuxHasSession(channelId: string): boolean {
  try {
    execFileSync('tmux', ['-L', TMUX_SOCKET, 'has-session', '-t', sessionName(channelId)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function tmuxKillSession(channelId: string): void {
  try {
    execFileSync('tmux', ['-L', TMUX_SOCKET, 'kill-session', '-t', sessionName(channelId)], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
}

/** Clean text of a channel's screen + scrollback (line-structured, no escapes) — for search. */
export function tmuxCapture(channelId: string, lines = 3000): string {
  try {
    return execFileSync(
      'tmux',
      ['-L', TMUX_SOCKET, 'capture-pane', '-p', '-t', sessionName(channelId), '-S', `-${lines}`],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return '';
  }
}

/** Session names currently alive on the clack tmux server (channel ids without the prefix). */
export function tmuxLiveChannelIds(): Set<string> {
  try {
    const out = execFileSync('tmux', ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(
      out
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('clack-'))
        .map((s) => s.slice('clack-'.length)),
    );
  } catch {
    return new Set(); // no server running yet
  }
}

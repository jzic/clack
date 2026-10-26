import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { ChunkRingBuffer } from './ringBuffer';
import { PtySignalParser } from './ptySignals';
import { ChannelStatus } from './statusEngine';
import { TMUX_SOCKET, confPath, sessionName, tmuxHasSession, tmuxKillSession } from './tmux';
import type { ChannelConfig } from './config';
import type { ChannelInfo, Handoff, NeedsReason } from '../../shared/protocol';

const COALESCE_MS = 8;
const COALESCE_MAX_BYTES = 64 * 1024;
const AUTOSTART_DELAY_MS = 400;
const PAUSE_FAILSAFE_MS = 30_000;

/**
 * The server may be launched via `npm start` (launcher, launchd), which injects
 * `npm_config_*`, `npm_lifecycle_*`, `INIT_CWD`, etc. into its environment.
 * Those are npm-run artifacts that must never reach an interactive shell — in
 * particular `npm_config_prefix` makes nvm bail ("not compatible with the
 * npm_config_prefix environment variable"), which then breaks `claude`. A Clack
 * channel must look like a fresh Terminal window, so strip them.
 */
function cleanShellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_') || key === 'INIT_CWD' || key === 'PROJECT_CWD') continue;
    env[key] = value;
  }
  // launchd sets no locale, which leaves tmux in non-UTF-8 mode — it then renders
  // Claude's Unicode prompt glyphs as placeholder characters. Give it a UTF-8 locale.
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8';
  return env;
}

export interface ChannelEvents {
  onOutput: (channel: Channel, data: Buffer) => void;
  onStatus: (channel: Channel) => void;
  onAttention: (channel: Channel, kind: NeedsReason | 'review' | 'error', message?: string) => void;
  onExit: (channel: Channel, exitCode: number) => void;
  onHandoff?: (channel: Channel, h: Handoff) => void;
}

export class Channel {
  readonly id: string;
  readonly idx: number;
  /** Sidebar display order (user-reorderable); set/owned by ChannelManager. */
  order = 0;
  name: string;
  readonly cwd: string;
  autostart?: string;
  readonly shell: boolean;
  readonly status: ChannelStatus;
  ptyAlive = false;

  private proc?: IPty;
  private ring = new ChunkRingBuffer(2 * 1024 * 1024); // ~2MB replayed on browser reload
  private parser: PtySignalParser;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private flushTimer?: NodeJS.Timeout;
  private lastFlushAt = 0;
  private paused = false;
  private pauseTimer?: NodeJS.Timeout;
  private killing = false; // set when WE kill it, so its exit isn't flagged as a crash

  constructor(cfg: ChannelConfig, idx: number, private port: number, private events: ChannelEvents) {
    this.id = cfg.id;
    this.idx = idx;
    this.name = cfg.name;
    this.cwd = cfg.cwd;
    this.autostart = cfg.autostart;
    this.shell = cfg.shell ?? false;
    this.status = new ChannelStatus({
      onChange: () => events.onStatus(this),
      onAttention: (kind, message) => events.onAttention(this, kind, message),
      onHandoff: (h) => events.onHandoff?.(this, h),
    });
    this.status.shell = this.shell;
    this.parser = new PtySignalParser({
      onBell: () => this.status.bell(),
      onTitle: (t) => this.status.setTitle(t),
    });
  }

  spawn(cols: number, rows: number, autostartOverride?: string): void {
    if (this.ptyAlive) return;
    this.killing = false;
    // A surviving tmux session means we're re-attaching (e.g. after a server
    // restart) — the shell/Claude is still live, so don't re-run the autostart.
    const reattaching = tmuxHasSession(this.id);
    try {
      this.proc = nodePty.spawn(
        'tmux',
        [
          '-u', // force UTF-8 output to the client (fixes Unicode glyphs under launchd's empty locale)
          '-L', TMUX_SOCKET,
          '-f', confPath(),
          'new-session', '-A', '-s', sessionName(this.id),
          '-c', this.cwd,
          '-e', 'LANG=en_US.UTF-8',
          '-e', `CLACK_CHANNEL_ID=${this.id}`,
          '-e', `CLACK_PORT=${this.port}`,
          '-e', 'COLORTERM=truecolor',
          '-x', String(cols), '-y', String(rows),
        ],
        { name: 'xterm-256color', cols, rows, cwd: this.cwd, env: cleanShellEnv() },
      );
    } catch (err) {
      // a channel that can't spawn must never take the PTY-holder down
      console.error(`clack: failed to start tmux for #${this.name}:`, (err as Error).message);
      this.status.crashed(-1);
      this.events.onExit(this, -1);
      return;
    }
    this.ptyAlive = true;
    this.proc.onData((data) => this.handleData(Buffer.from(data, 'utf8')));
    this.proc.onExit(({ exitCode, signal }) => {
      this.ptyAlive = false;
      this.flush();
      // An exit we didn't ask for, with a non-zero code or a signal, is a crash.
      if (!this.killing && (exitCode !== 0 || signal)) {
        this.status.crashed(exitCode || (signal ? 128 + signal : 1));
      } else {
        this.status.ptyExit();
      }
      this.events.onExit(this, exitCode);
    });
    if (!reattaching) {
      // Fresh session: run the autostart. Plain `claude` becomes a resume, so a
      // reboot (which does clear the tmux server) still comes back mid-conversation.
      const raw = autostartOverride ?? this.autostart;
      const cmd = raw === 'claude' ? 'claude --continue 2>/dev/null || claude' : raw;
      if (cmd) {
        setTimeout(() => {
          if (this.ptyAlive) this.proc!.write(cmd + '\r');
        }, AUTOSTART_DELAY_MS);
      }
    }
  }

  write(data: Buffer): void {
    if (!this.ptyAlive) return;
    // NB: do NOT treat this as user input — xterm also sends automatic replies
    // here (device-attribute responses, focus in/out). Real keystrokes arrive
    // as a separate 'acted' signal (see acted()).
    this.proc!.write(data.toString('utf8'));
  }

  /**
   * Type a prompt into Claude and submit it. Multi-line text goes in as a
   * bracketed paste so its newlines don't submit early; Enter follows a beat
   * later so the TUI doesn't swallow it as part of the paste.
   */
  sendPrompt(text: string): void {
    if (!this.ptyAlive || !text.trim()) return;
    const body = text.replace(/\r\n?/g, '\n');
    this.proc!.write(body.includes('\n') ? `\x1b[200~${body}\x1b[201~` : body);
    setTimeout(() => {
      if (this.ptyAlive) this.proc!.write('\r');
    }, 120);
    this.status.userInput();
  }

  /** A genuine keystroke landed in this channel (from xterm's onKey, not auto-replies). */
  acted(): void {
    this.status.userInput();
  }

  resize(cols: number, rows: number): void {
    if (this.ptyAlive) this.proc!.resize(cols, rows);
  }

  /** cols-1 then back: the SIGWINCH pair forces alt-screen apps (Claude TUI, vim) to fully repaint after a replay. */
  wiggle(cols: number, rows: number): void {
    if (!this.ptyAlive || cols < 2) return;
    this.proc!.resize(cols - 1, rows);
    setTimeout(() => {
      if (this.ptyAlive) this.proc!.resize(cols, rows);
    }, 50);
  }

  pause(): void {
    if (this.paused || !this.ptyAlive) return;
    this.paused = true;
    this.proc!.pause();
    // failsafe: never leave a channel frozen if the resume message gets lost
    this.pauseTimer = setTimeout(() => this.resume(), PAUSE_FAILSAFE_MS);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
    if (this.ptyAlive) this.proc!.resume();
  }

  replaySnapshot(): Buffer {
    return this.ring.snapshot();
  }

  kill(): void {
    this.killing = true; // intentional — don't flag the resulting exit as a crash
    tmuxKillSession(this.id); // end the durable session, not just this attachment
    this.proc?.kill();
  }

  /** Clear an ERROR state so a respawn starts clean. */
  resetStatus(): void {
    this.status.reset();
  }

  info(): ChannelInfo {
    const s = this.status.snapshot();
    return {
      id: this.id,
      idx: this.idx,
      order: this.order,
      name: this.name,
      cwd: this.cwd,
      autostart: this.autostart,
      shell: this.shell,
      state: s.state,
      reason: s.reason,
      attentionMessage: s.attentionMessage,
      exitCode: s.exitCode,
      unread: s.unread,
      title: s.title,
      waitingSince: s.waitingSince,
      ptyAlive: this.ptyAlive,
      handoff: s.handoff,
    };
  }

  private handleData(buf: Buffer): void {
    this.ring.push(buf);
    this.parser.feed(buf);
    this.status.output();
    this.pending.push(buf);
    this.pendingBytes += buf.length;
    if (this.pendingBytes >= COALESCE_MAX_BYTES) {
      this.flush();
      return;
    }
    if (this.flushTimer) return; // a flush is already scheduled; this data rides along
    // Leading-edge: the first output after a quiet gap goes out immediately (no
    // 8ms wait); a burst within the window batches into one trailing flush.
    const sinceLast = Date.now() - this.lastFlushAt;
    if (sinceLast >= COALESCE_MS) this.flush();
    else this.flushTimer = setTimeout(() => this.flush(), COALESCE_MS - sinceLast);
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.pending.length) return;
    const buf = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
    this.pending = [];
    this.pendingBytes = 0;
    this.lastFlushAt = Date.now();
    this.events.onOutput(this, buf);
  }
}

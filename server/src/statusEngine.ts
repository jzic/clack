import type { ChannelState, Handoff, NeedsReason } from '../../shared/protocol';

export type HookEventName = 'SessionStart' | 'UserPromptSubmit' | 'Notification' | 'Stop' | 'SessionEnd';

export interface StatusSnapshot {
  state: ChannelState;
  reason?: NeedsReason;
  unread: boolean;
  title: string;
  waitingSince?: number;
  /** The actual ask, from the Notification hook — "why it needs you". */
  attentionMessage?: string;
  /** Exit/crash code when state is ERROR. */
  exitCode?: number;
  handoff?: Handoff;
}

export interface StatusCallbacks {
  /** Something user-visible changed — push to clients. */
  onChange: (snap: StatusSnapshot) => void;
  /** Channel newly needs the user — candidate for a macOS notification. */
  onAttention: (kind: NeedsReason | 'review' | 'error', message?: string) => void;
  /** A finished turn's summary arrived (read from the transcript after Stop). */
  onHandoff?: (h: Handoff) => void;
}

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

// Hooks drive this machine; PTY signals (bell/output) corroborate and provide
// a degraded mode when hooks aren't installed. Never let a scrape beat a hook.
const STOP_WINS_WINDOW_MS = 500; // Notification right after Stop is turn-boundary noise
const PROMPT_GRACE_MS = 250; // Stop right after UserPromptSubmit is out-of-order delivery
const BELL_PROMOTE_MS = 1500; // give the Notification hook a chance before trusting a bare bell
const REVIEW_DWELL_MS = 1500; // focused this long => the user has seen the finished turn
const DEGRADED_IDLE_MS = 2000; // output quiet this long in degraded mode => not working

const realTimers: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class ChannelStatus {
  state: ChannelState = 'NO_CLAUDE';
  reason?: NeedsReason;
  unread = false;
  title = '';
  waitingSince?: number;
  attentionMessage?: string;
  exitCode?: number;
  handoff?: Handoff;
  /** Bumped on every prompt, so a late-arriving handoff can tell it's stale. */
  turn = 0;
  /** Scratch terminal: never infer Claude activity from raw output/bells. */
  shell = false;

  private focused = false;
  private hooksSeen = false;
  private lastPromptAt = -Infinity;
  private lastStopAt = -Infinity;
  private outputSeconds: number[] = []; // trailing distinct seconds with output (degraded mode)
  private bellTimer: unknown;
  private dwellTimer: unknown;
  private idleTimer: unknown;

  constructor(
    private cb: StatusCallbacks,
    private now: () => number = Date.now,
    private timers: Scheduler = realTimers,
  ) {}

  snapshot(): StatusSnapshot {
    return {
      state: this.state,
      reason: this.reason,
      unread: this.unread,
      title: this.title,
      waitingSince: this.waitingSince,
      attentionMessage: this.attentionMessage,
      exitCode: this.exitCode,
      handoff: this.handoff,
    };
  }

  hook(event: HookEventName, message?: string): void {
    this.hooksSeen = true;
    const t = this.now();
    switch (event) {
      case 'SessionStart':
        this.toState('CLAUDE_IDLE');
        break;
      case 'UserPromptSubmit':
        this.lastPromptAt = t;
        this.turn++;
        this.handoff = undefined; // the previous turn's words are answered
        this.toState('WORKING');
        break;
      case 'Notification': {
        if (t - this.lastStopAt < STOP_WINS_WINDOW_MS && this.state === 'REVIEW') break;
        const reason: NeedsReason = message && /permission/i.test(message) ? 'permission' : 'waiting_input';
        // "Claude is waiting for your input" is Claude Code's idle reminder, ~60s
        // after a turn ends — never a block. At most it tells us a turn ended that
        // we missed the Stop for (e.g. a monitor-driven turn): treat it as a
        // finished turn to review. A finished or already-seen turn stays as is.
        if (reason === 'waiting_input') {
          if (this.state !== 'REVIEW' && this.state !== 'CLAUDE_IDLE') {
            this.toState(this.focused ? 'CLAUDE_IDLE' : 'REVIEW');
            if (!this.focused) this.cb.onAttention('review');
          }
          break;
        }
        this.attentionMessage = message?.trim() || undefined;
        this.toState('NEEDS_INPUT', reason);
        this.cb.onAttention(reason, message);
        break;
      }
      case 'Stop': {
        this.lastStopAt = t;
        if (t - this.lastPromptAt < PROMPT_GRACE_MS) break; // stale Stop that raced a new prompt
        if (this.focused) {
          this.toState('CLAUDE_IDLE');
        } else {
          this.toState('REVIEW');
          this.cb.onAttention('review');
        }
        break;
      }
      case 'SessionEnd':
        this.toState('NO_CLAUDE');
        break;
    }
  }

  /** Any keystroke the user sends into this channel. */
  userInput(): void {
    // Typing into a channel that needs you clears the badge — but does NOT mean
    // "Claude is working" (the pulse). Claude only actually starts on a prompt
    // submit (the UserPromptSubmit hook drives WORKING). Guessing WORKING here
    // left the pulse stuck when you typed and then deleted without submitting.
    // Drop to idle instead; the hook flips it to WORKING when you truly send.
    if (this.state === 'NEEDS_INPUT' || this.state === 'REVIEW') {
      this.toState('CLAUDE_IDLE');
    }
  }

  /**
   * User dismissed the attention without necessarily acting on it ("I've seen
   * this, stop flagging it"). Downgrades to the resting state: a finished/idle
   * turn or a block falls back to CLAUDE_IDLE; a crash falls back to NO_CLAUDE.
   * The next hook re-flags if genuinely new activity arrives.
   */
  acknowledge(): void {
    this.unread = false;
    if (this.state === 'ERROR') this.toState('NO_CLAUDE');
    else if (this.state === 'NEEDS_INPUT' || this.state === 'REVIEW') this.toState('CLAUDE_IDLE');
    else this.emit();
  }

  /** PTY produced output. */
  output(): void {
    let changed = false;
    if (!this.focused && !this.unread) {
      this.unread = true;
      changed = true;
    }
    if (!this.hooksSeen && !this.shell) changed = this.degradedActivity(this.now()) || changed;
    if (changed) this.emit();
  }

  /** BEL byte outside an escape sequence. */
  bell(): void {
    if (this.hooksSeen) {
      // corroborating signal only: promote if the Notification hook never shows up
      if (this.state !== 'WORKING') return;
      this.timers.clear(this.bellTimer);
      this.bellTimer = this.timers.set(() => {
        if (this.state === 'WORKING') {
          this.toState('NEEDS_INPUT', 'bell');
          this.cb.onAttention('bell');
        }
      }, BELL_PROMOTE_MS);
    } else if (!this.focused && !this.shell) {
      // degraded mode: an unfocused bell is Claude's terminal_bell notification;
      // zsh/vim bells happen while you're typing, i.e. focused, so this filters most noise.
      // Scratch terminals never run Claude, so their bells never mean "needs you".
      this.toState('NEEDS_INPUT', 'bell');
      this.cb.onAttention('bell');
    }
  }

  /** True when the app is focused AND this channel is the active one. */
  focus(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    let changed = false;
    if (focused && this.unread) {
      this.unread = false;
      changed = true;
    }
    this.timers.clear(this.dwellTimer);
    if (focused && this.state === 'REVIEW') {
      this.dwellTimer = this.timers.set(() => {
        if (this.focused && this.state === 'REVIEW') this.toState('CLAUDE_IDLE');
      }, REVIEW_DWELL_MS);
    }
    if (changed) this.emit();
  }

  /** Attach a turn's summary — ignored if a newer prompt has started since that Stop. */
  setHandoff(h: Handoff, turn: number): void {
    if (turn !== this.turn) return;
    this.handoff = h;
    this.emit();
    this.cb.onHandoff?.(h);
  }

  setTitle(title: string): void {
    if (this.title === title) return;
    this.title = title;
    this.emit();
  }

  /** Clean/intentional process exit. */
  ptyExit(): void {
    this.toState('NO_CLAUDE');
  }

  /** Process died unexpectedly (non-zero exit or a crash signal). */
  crashed(exitCode: number): void {
    this.exitCode = exitCode;
    this.toState('ERROR');
    this.cb.onAttention('error');
  }

  /** Channel respawned — back to a clean slate. */
  reset(): void {
    this.exitCode = undefined;
    this.toState('NO_CLAUDE');
  }

  private toState(state: ChannelState, reason?: NeedsReason): void {
    this.timers.clear(this.dwellTimer);
    this.timers.clear(this.bellTimer);
    this.state = state;
    this.reason = state === 'NEEDS_INPUT' ? reason : undefined;
    if (state !== 'NEEDS_INPUT') this.attentionMessage = undefined; // the ask is answered/gone
    if (state !== 'ERROR') this.exitCode = undefined;
    this.waitingSince =
      state === 'NEEDS_INPUT' || state === 'REVIEW' || state === 'ERROR' ? this.now() : undefined;
    this.emit();
  }

  private degradedActivity(t: number): boolean {
    const sec = Math.floor(t / 1000);
    if (this.outputSeconds[this.outputSeconds.length - 1] !== sec) {
      this.outputSeconds.push(sec);
      while (this.outputSeconds.length && this.outputSeconds[0] < sec - 4) this.outputSeconds.shift();
    }
    this.timers.clear(this.idleTimer);
    this.idleTimer = this.timers.set(() => {
      if (!this.hooksSeen && this.state === 'WORKING') this.toState('NO_CLAUDE');
    }, DEGRADED_IDLE_MS);
    // output in >=3 of the trailing 5 seconds looks like a busy Claude
    if (this.outputSeconds.length >= 3 && this.state === 'NO_CLAUDE') {
      this.state = 'WORKING';
      return true;
    }
    return false;
  }

  private emit(): void {
    this.cb.onChange(this.snapshot());
  }
}

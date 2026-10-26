import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

// Client-side watermarks for per-channel flow control (server pauses the PTY).
// Generous so heavy bursts buffer rather than throttling the producer early.
const PAUSE_AT = 2 * 1024 * 1024;
const RESUME_AT = 256 * 1024;

const THEME = {
  background: '#0d0f12',
  foreground: '#d6d9de',
  cursor: '#e8695a',
  cursorAccent: '#0d0f12',
  selectionBackground: 'rgba(232, 105, 90, 0.28)',
  black: '#1c1f24',
  red: '#ff6b61',
  green: '#7fd88f',
  yellow: '#e5c07b',
  blue: '#6fa8ff',
  magenta: '#c792ea',
  cyan: '#56c8d8',
  white: '#d6d9de',
  brightBlack: '#5c6370',
  brightRed: '#ff8a80',
  brightGreen: '#9fe8ac',
  brightYellow: '#f0d399',
  brightBlue: '#8fbcff',
  brightMagenta: '#d7a8f0',
  brightCyan: '#7adfe8',
  brightWhite: '#f2f4f8',
};

interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  pending: number;
  paused: boolean;
  opened: boolean;
}

class TermRegistry {
  sendInput?: (id: string, data: string) => void;
  sendFlow?: (id: string, action: 'pause' | 'resume') => void;
  /** A genuine keystroke went into this channel (not an app shortcut / auto-reply). */
  onUserActed?: (id: string) => void;
  /** Return true when the app consumed the key (xterm then ignores it). */
  onKeyEvent?: (e: KeyboardEvent) => boolean;

  private entries = new Map<string, Entry>();
  private webgl?: WebglAddon;
  private webglBroken = false;
  private webglLogged = false;
  private activeId?: string;
  private cols = 120;
  private rows = 32;

  /**
   * Adopt the server's grid size. Called from the `hello` handler BEFORE any
   * replay bytes arrive, so new terminals parse the replay at the same width
   * Claude emitted it — otherwise the default 80-col buffer wraps every line
   * wrong and no later resize can un-mangle the primary-buffer scrollback.
   */
  setSize(cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return;
    this.cols = cols;
    this.rows = rows;
    for (const entry of this.entries.values()) entry.term.resize(cols, rows);
  }

  /** Terminals are created eagerly so replay bytes buffer even before the DOM mounts. */
  ensure(id: string): Entry {
    let entry = this.entries.get(id);
    if (entry) return entry;
    const term = new Terminal({
      allowProposedApi: true,
      cols: this.cols,
      rows: this.rows,
      scrollback: 5000,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      lineHeight: 1.25,
      cursorBlink: true,
      macOptionIsMeta: false, // leave Option for word-jump and international input
      theme: THEME,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = '11'; // Claude output is emoji/box-drawing heavy
    term.onData((d) => this.sendInput?.(id, d));
    // onKey fires only for real keyboard input, never for xterm's automatic
    // replies (DA/DSR/focus) — so it's the honest "the user is responding here" signal.
    term.onKey(() => this.onUserActed?.(id));
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && this.onKeyEvent?.(e)) return false;
      return true;
    });
    entry = { term, fit, search, pending: 0, paused: false, opened: false };
    this.entries.set(id, entry);
    return entry;
  }

  open(id: string, el: HTMLElement): void {
    const entry = this.ensure(id);
    if (entry.opened) return;
    entry.term.open(el);
    entry.opened = true;
    if (id === this.activeId) this.activate(entry, id);
  }

  write(id: string, bytes: Uint8Array): void {
    const entry = this.ensure(id);
    const len = bytes.byteLength;
    entry.pending += len;
    entry.term.write(bytes, () => {
      entry.pending -= len;
      if (entry.paused && entry.pending < RESUME_AT) {
        entry.paused = false;
        this.sendFlow?.(id, 'resume');
      }
    });
    if (!entry.paused && entry.pending > PAUSE_AT) {
      entry.paused = true;
      this.sendFlow?.(id, 'pause');
    }
  }

  reset(id: string): void {
    this.ensure(id).term.reset();
  }

  setActive(id: string): void {
    if (this.activeId === id) {
      this.entries.get(id)?.term.focus();
      return;
    }
    this.activeId = id;
    const entry = this.entries.get(id);
    if (entry?.opened) this.activate(entry, id);
  }

  focusActive(): void {
    if (this.activeId) this.entries.get(this.activeId)?.term.focus();
  }

  /** Highlighted text in the active terminal (empty string if none) — for spark capture. */
  getActiveSelection(): string {
    if (!this.activeId) return '';
    return this.entries.get(this.activeId)?.term.getSelection().trim() ?? '';
  }

  clearActiveSelection(): void {
    if (this.activeId) this.entries.get(this.activeId)?.term.clearSelection();
  }

  /** Measure the active (visible) pane; all panes share these dimensions. */
  fitActive(): { cols: number; rows: number } | undefined {
    const entry = this.activeId ? this.entries.get(this.activeId) : undefined;
    if (!entry?.opened) return undefined;
    const dims = entry.fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || dims.cols < 2 || dims.rows < 2) return undefined;
    return dims;
  }

  resizeAll(cols: number, rows: number): void {
    for (const entry of this.entries.values()) {
      if (entry.opened) entry.term.resize(cols, rows);
    }
  }

  dispose(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (id === this.activeId) {
      this.webgl?.dispose();
      this.webgl = undefined;
      this.activeId = undefined;
    }
    entry.term.dispose();
    this.entries.delete(id);
  }

  private activate(entry: Entry, id: string): void {
    this.attachWebgl(entry);
    entry.term.focus();
    // an active channel must never sit frozen behind a stale pause
    if (entry.paused) {
      entry.paused = false;
      this.sendFlow?.(id, 'resume');
    }
  }

  /** Exactly one WebGL context, on the visible terminal; DOM renderer elsewhere. */
  private attachWebgl(entry: Entry): void {
    this.webgl?.dispose();
    this.webgl = undefined;
    if (this.webglBroken) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        this.webgl = undefined;
        this.webglBroken = true; // fall back to the DOM renderer for the session
        console.warn('[clack] WebGL context lost — using the slower DOM renderer');
      });
      entry.term.loadAddon(addon);
      this.webgl = addon;
      if (!this.webglLogged) {
        this.webglLogged = true;
        console.info('[clack] WebGL renderer active');
      }
    } catch (err) {
      this.webglBroken = true;
      console.warn('[clack] WebGL unavailable — using the slower DOM renderer', err);
    }
  }
}

export const termRegistry = new TermRegistry();

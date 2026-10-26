import { socket } from './socket';
import { termRegistry } from './termRegistry';
import { useStore, byIdx, needsYou } from './store';

let lastSent = { cols: 0, rows: 0 };

/** An explicit switch: wherever you land becomes "home" (ends any visit). */
export function activateChannel(id: string): void {
  useStore.getState().setReturnTo(null);
  switchTo(id);
}

function switchTo(id: string): void {
  const st = useStore.getState();
  if (!st.channels[id]) return;
  if (st.wallOpen) st.setWallOpen(false); // going to a terminal means leaving the wall
  st.setActive(id);
  socket.send({ type: 'focus', id });
  termRegistry.setActive(id);
  // pane visibility just changed; measure on the next frame
  requestAnimationFrame(() => requestFit());
}

export function requestFit(): void {
  // The PTY grid size is shared across every connected window, so only the
  // FOCUSED window may drive it. Otherwise a background or transiently-small
  // window can broadcast a tiny width and wrap everyone's output to a couple
  // of columns until a correctly-sized window re-measures.
  if (!document.hasFocus()) return;
  const dims = termRegistry.fitActive();
  if (!dims) return;
  termRegistry.resizeAll(dims.cols, dims.rows);
  if (dims.cols !== lastSent.cols || dims.rows !== lastSent.rows) {
    lastSent = dims;
    socket.send({ type: 'resize', cols: dims.cols, rows: dims.rows });
  }
}

/**
 * After a (re)connect's replay finishes, send our true geometry, then ask the
 * server to wiggle so every alt-screen app repaints over the stale replayed
 * bytes at the correct size. Ordered before the resize so the server's cols are
 * current when it wiggles.
 */
export function redrawAfterReconnect(): void {
  // Only a focused window re-establishes the size (see requestFit); an
  // unfocused one still asks for a repaint at the current size.
  const dims = document.hasFocus() ? termRegistry.fitActive() : undefined;
  if (dims) {
    termRegistry.resizeAll(dims.cols, dims.rows);
    lastSent = dims;
    socket.send({ type: 'resize', cols: dims.cols, rows: dims.rows });
  }
  socket.send({ type: 'redraw' });
}

export function stepChannel(delta: number): void {
  const st = useStore.getState();
  const order = byIdx(st.channels);
  if (!order.length) return;
  const i = order.findIndex((c) => c.id === st.activeId);
  const next = order[(i + delta + order.length) % order.length];
  activateChannel(next.id);
}

/**
 * Cmd/Ctrl+0 — triage. First press opens the inbox bar and jumps to the
 * longest-waiting channel; each subsequent press walks to the next one.
 */
export function triage(): void {
  const st = useStore.getState();
  const queue = needsYou(st.channels);
  if (!queue.length) {
    st.setInboxOpen(false);
    return;
  }
  if (!st.inboxOpen) {
    st.setInboxOpen(true);
    activateChannel(queue[0].id); // longest-waiting first
  } else {
    inboxStep(1);
  }
}

/** Step through the needs-you queue (used by the inbox bar and repeated ⌘0). */
export function inboxStep(delta: number): void {
  const st = useStore.getState();
  const queue = needsYou(st.channels);
  if (!queue.length) return;
  const i = queue.findIndex((c) => c.id === st.activeId);
  const from = i === -1 ? 0 : i;
  activateChannel(queue[(from + delta + queue.length) % queue.length].id);
}

/** "I've seen it" — clears a channel's attention badge back to plain gray. */
export function dismissChannel(id: string): void {
  socket.send({ type: 'dismiss', id });
}

export function createChannel(name: string, cwd: string, autostart?: string): void {
  socket.send({ type: 'create', name, cwd, autostart });
}

/** One-click scratch terminal: a plain shell in the home dir, no Claude, no badges. */
export function createTerminal(): void {
  socket.send({ type: 'create', name: uniqueName('terminal'), cwd: '~', shell: true });
}

function uniqueName(base: string): string {
  const taken = new Set(Object.values(useStore.getState().channels).map((c) => c.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Opens the in-app close confirmation (see ConfirmDialog). */
export function removeChannel(id: string): void {
  const ch = useStore.getState().channels[id];
  if (ch) useStore.getState().setConfirmClose({ id, name: ch.name });
}

export function confirmRemove(): void {
  const pending = useStore.getState().confirmClose;
  if (pending) socket.send({ type: 'remove', id: pending.id });
  useStore.getState().setConfirmClose(null);
}

/** Starts inline editing of a channel's name in the sidebar. */
export function renameChannel(id: string): void {
  if (useStore.getState().channels[id]) useStore.getState().setRenamingId(id);
}

export function commitRename(id: string, name: string): void {
  const trimmed = name.trim();
  const ch = useStore.getState().channels[id];
  if (ch && trimmed && trimmed !== ch.name) socket.send({ type: 'rename', id, name: trimmed });
  useStore.getState().setRenamingId(null);
}

export function respawnChannel(id: string, continueClaude: boolean): void {
  socket.send({ type: 'respawn', id, continueClaude });
}

/** Commit a new sidebar order: apply locally at once (no flicker), then persist
 *  server-side, which echoes the canonical order back to every window. */
export function reorderChannels(orderedIds: string[]): void {
  useStore.getState().applyOrder(orderedIds);
  socket.send({ type: 'reorder', orderedIds });
}

export function saveTemplate(name: string): void {
  if (name.trim()) socket.send({ type: 'saveTemplate', name: name.trim() });
}

export function launchTemplate(name: string): void {
  socket.send({ type: 'launchTemplate', name });
}

export function deleteTemplate(name: string): void {
  socket.send({ type: 'deleteTemplate', name });
}

// ---------- file drop → insert path (like a native terminal) ----------

// Match a native terminal's drag-in: backslash-escape anything the shell would
// choke on (spaces, parens, quotes…), leaving ordinary path chars untouched.
const escapeForShell = (p: string) => p.replace(/[^A-Za-z0-9_./\-@%+:,=]/g, (c) => `\\${c}`);

/** Pull absolute paths out of a Finder drag. Chrome exposes them as file:// URIs
 *  in text/uri-list (or text/plain); the File objects themselves are basename-only. */
function extractDroppedPaths(dt: DataTransfer): string[] {
  const raw = dt.getData('text/uri-list') || dt.getData('text/plain');
  const paths: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue; // uri-list comment lines
    if (s.startsWith('file:')) {
      try {
        paths.push(decodeURIComponent(new URL(s).pathname));
      } catch {
        /* malformed URI — skip */
      }
    }
  }
  return paths;
}

let fileDropNoticeShown = false;

/**
 * A drop onto Clack. If the drag carries a real path (a file:// URI — e.g. a
 * dragged link, or some non-Finder sources) we insert it, native-terminal style.
 * Dropped plain text goes in as-is. But a file dragged from Finder is the common
 * case, and browsers deliberately withhold its absolute path from web pages for
 * security — there's nothing to insert. We never let Chrome open/navigate to it
 * (the caller preventDefault'd); we just explain the limitation once, calmly.
 */
export function handleFileDrop(dt: DataTransfer): void {
  const id = useStore.getState().activeId;
  if (!id) return;

  const paths = extractDroppedPaths(dt);
  if (paths.length) {
    socket.sendInput(id, paths.map(escapeForShell).join(' '));
    return;
  }
  const text = dt.getData('text/plain');
  if (text) {
    socket.sendInput(id, text);
    return;
  }
  if (dt.files && dt.files.length && !fileDropNoticeShown) {
    fileDropNoticeShown = true; // once per session — not on every drop
    showToast('the browser hides file paths — drag-to-insert needs a native app');
  }
}

/** Apply a zen state received from (or echoed by) the server. Zen collapses the
 *  channel bar by default — you can still expand it manually while in zen. */
export function applyZen(on: boolean): void {
  const st = useStore.getState();
  st.setZen(on);
  st.setSidebarCollapsed(on);
}

export function toggleZen(): void {
  const on = !useStore.getState().zen;
  applyZen(on); // optimistic; the server echo reconciles
  socket.send({ type: 'zen', on });
}

// ---------- Visit-and-return ----------
// A session that needs you is a round trip, not a context switch: go to its real
// terminal (full scrollback = full context), answer, and hop back where you were.
// The hop back is always yours (↩ / ⌃0) — never switch the view out from under you.

/** Pop over to a waiting session, remembering home. Chained visits keep the original home. */
export function visit(id: string): void {
  const st = useStore.getState();
  if (!st.channels[id] || id === st.activeId) return;
  const home = st.returnTo ?? st.activeId;
  switchTo(id);
  useStore.getState().setReturnTo(home && home !== id ? home : null);
}

export function returnHome(): void {
  const home = useStore.getState().returnTo;
  useStore.getState().setReturnTo(null);
  if (home) switchTo(home);
}

/** ⌃0 with the dock: next session waiting on you; when there are none left, home. */
export function visitNext(): void {
  const st = useStore.getState();
  const queue = needsYou(st.channels);
  // advance past the one you're on (not "oldest that isn't me", which ping-pongs)
  const at = queue.findIndex((c) => c.id === st.activeId);
  const next = at === -1 ? queue[0] : queue[(at + 1) % queue.length];
  if (next && next.id !== st.activeId) visit(next.id);
  else if (st.returnTo) returnHome();
}

// ---------- The wall: tiles + handoff cards ----------

export function openWall(): void {
  const st = useStore.getState();
  st.setWallOpen(true);
  st.setInboxOpen(false);
  // No terminal is "being looked at" while the wall is up, so every finished
  // turn lands as a card instead of silently going idle.
  socket.send({ type: 'focus', id: null });
  (document.activeElement as HTMLElement | null)?.blur(); // keystrokes must not reach a hidden xterm
}

export function toggleWall(): void {
  const st = useStore.getState();
  if (!st.wallOpen) openWall();
  else if (st.activeId) activateChannel(st.activeId);
  else st.setWallOpen(false);
}

/** Submit a prompt to a channel's Claude straight from its card. */
export function replyTo(id: string, text: string): void {
  if (text.trim()) socket.send({ type: 'reply', id, text });
}

/** The docked wall is on screen (not collapsed, not covered by the full wall). */
export function dockVisible(): boolean {
  const st = useStore.getState();
  return !st.sidebarCollapsed && !st.wallOpen;
}

export function toggleSidebar(): void {
  const st = useStore.getState();
  st.setSidebarCollapsed(!st.sidebarCollapsed);
}

// ---------- Sparks: capture ideas, resurface them, act on them ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string): void {
  useStore.getState().setToast(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useStore.getState().setToast(null), 1900);
}

async function readClipboard(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()).trim();
  } catch {
    return ''; // no permission / not focused — fall back to a blank jot box
  }
}

/**
 * ⌘I — capture a spark. Selection-aware, with a clipboard fallback:
 *  - xterm owns a selection (shell, mouse-mode-off app) → save it immediately.
 *  - otherwise a TUI like Claude Code owns the drag-select (mouse mode) and
 *    auto-copies to the clipboard, so xterm has no selection of its own — pull
 *    the clipboard text and open the jot bar pre-filled (auto-selected: hit
 *    Enter to keep it, or just type to replace). Either way: no manual paste.
 * Stamped with the active channel and its live title ("why this mattered").
 */
export async function captureSpark(): Promise<void> {
  const st = useStore.getState();
  const id = st.activeId;
  if (!id) return;
  const ch = st.channels[id];
  if (!ch) return;
  const context = ch.title.trim() || undefined;

  const selection = termRegistry.getActiveSelection();
  if (selection) {
    socket.send({ type: 'addSpark', channelId: id, text: selection, context });
    termRegistry.clearActiveSelection();
    showToast(`💡 saved to #${ch.name}`);
    return;
  }
  const clip = await readClipboard();
  st.setCaptureFor({ channelId: id, channelName: ch.name, context, prefill: clip || undefined });
}

/** Commit a jotted spark from the capture bar. */
export function submitSpark(text: string): void {
  const target = useStore.getState().captureFor;
  useStore.getState().setCaptureFor(null);
  const trimmed = text.trim();
  if (!target || !trimmed) return;
  socket.send({ type: 'addSpark', channelId: target.channelId, text: trimmed, context: target.context });
  showToast(`💡 saved to #${target.channelName}`);
}

export function openSparks(): void {
  useStore.getState().setSparksOpen(true);
}

export function editSpark(id: string, text: string): void {
  if (text.trim()) socket.send({ type: 'editSpark', id, text: text.trim() });
}

export function toggleSparkDone(id: string): void {
  socket.send({ type: 'toggleSpark', id });
}

export function deleteSpark(id: string): void {
  socket.send({ type: 'deleteSpark', id });
}

/** Promote a spark: jump to its channel and type it into the prompt (no newline —
 *  you review and hit enter). Turns "remember this" into "let's do it now". */
export function promoteSpark(spark: { channelId: string; text: string }): void {
  const exists = !!useStore.getState().channels[spark.channelId];
  useStore.getState().setSparksOpen(false);
  if (!exists) {
    showToast('channel is gone — copy it manually');
    return;
  }
  activateChannel(spark.channelId);
  // collapse newlines: raw PTY bytes would auto-run at the first \n in a shell.
  // Lands as one line in the prompt for you to review, then hit enter.
  const oneLine = spark.text.replace(/\s*\n\s*/g, ' ').trim();
  setTimeout(() => socket.sendInput(spark.channelId, oneLine), 60);
}

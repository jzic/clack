import { useStore, byIdx } from './store';
import { activateChannel, triage, stepChannel, toggleZen, captureSpark, openSparks, toggleWall, dockVisible, visitNext } from './actions';

/**
 * App-level shortcuts. Runs both from the window keydown (capture) and from
 * xterm's custom key handler so they work wherever focus is. Returns true when
 * consumed. Everything not handled here passes through to the shell untouched
 * (Esc, Ctrl+C/R/A/E/K/U/L, Shift+Tab, Option+Enter, arrows, Cmd+V...).
 */
export function handleAppKey(e: KeyboardEvent): boolean {
  const st = useStore.getState();
  // overlays / inline editors own the keyboard while open
  if (
    st.switcherOpen ||
    st.newChannelOpen ||
    st.renamingId ||
    st.confirmClose ||
    st.searchOpen ||
    st.templatesOpen ||
    st.sparksOpen ||
    st.captureFor
  )
    return false;

  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !e.altKey) return false;

  // Cmd/Ctrl+1..9 — switch by creation order (Cmd works in Tauri; Ctrl in the browser)
  if (mod && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    const target = byIdx(st.channels)[Number(e.key) - 1];
    if (target) activateChannel(target.id);
    return true;
  }
  if (mod && !e.shiftKey && !e.altKey && e.key === '0') {
    // with the dock up, the queue is already on screen: visit the next one (or go home)
    if (dockVisible()) visitNext();
    else triage();
    return true;
  }
  // Cmd/Ctrl+Shift+Z — toggle zen mode (mutes banners, collapses the bar).
  // Consumed here, so it never reaches the shell (no accidental Ctrl+Z suspend).
  if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    toggleZen();
    return true;
  }
  // Cmd/Ctrl+Shift+E — the wall (every session at a glance) <-> the terminal
  if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    toggleWall();
    return true;
  }
  // Cmd/Ctrl+Shift+F — search across all channels' scrollback
  if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    st.setSearchOpen(true);
    return true;
  }
  // Cmd+Shift+I — open the Sparks view (idea inbox)
  if (e.metaKey && !e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
    openSparks();
    return true;
  }
  // Cmd+I only — capture a spark. Ctrl+I is Tab (0x09) and must reach the shell.
  if (e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'i' || e.key === 'I')) {
    captureSpark();
    return true;
  }
  // Cmd+K only — Ctrl+K is readline kill-to-end-of-line and must reach the shell
  if (e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    st.setSwitcherOpen(true);
    return true;
  }
  if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    stepChannel(e.key === 'ArrowUp' ? -1 : 1);
    return true;
  }
  return false;
}

import { create } from 'zustand';
import type { ChannelInfo, SearchHit, Template, Spark } from '../../shared/protocol';

interface ClackState {
  channels: Record<string, ChannelInfo>;
  activeId: string | null;
  connected: boolean;
  everConnected: boolean;
  switcherOpen: boolean;
  newChannelOpen: boolean;
  lastActivity: Record<string, number>;
  zen: boolean;
  sidebarCollapsed: boolean;
  /** Left panel: the docked wall (tiles + cards) or the classic channel list. */
  /** Visit-and-return: the terminal you were working in before ⌃0 took you to a waiting one. */
  returnTo: string | null;
  /** The wall: every session as a tile + a queue of handoff cards, over the terminal view. */
  wallOpen: boolean;
  /** Ticks every ~15s so time-based escalation re-renders. */
  nowMs: number;
  /** Channel whose name is being edited inline (null = none). */
  renamingId: string | null;
  /** Pending close-confirmation, or null. */
  confirmClose: { id: string; name: string } | null;
  searchOpen: boolean;
  searchHits: SearchHit[];
  /** Triage mode: a slim bar walks you through the needs-you queue. */
  inboxOpen: boolean;
  templates: Template[];
  templatesOpen: boolean;
  /** Captured ideas ("Sparks") across all channels. */
  sparks: Spark[];
  sparksOpen: boolean;
  /** When set, the quick-capture bar is open for this channel (prefill from clipboard when a TUI owned the drag-select). */
  captureFor: { channelId: string; channelName: string; context?: string; prefill?: string } | null;
  /** Ephemeral confirmation toast (e.g., "💡 saved to #api-server"), or null. */
  toast: string | null;
  hello: (list: ChannelInfo[]) => void;
  upsert: (ch: ChannelInfo) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  setConnected: (v: boolean) => void;
  setSwitcherOpen: (v: boolean) => void;
  setNewChannelOpen: (v: boolean) => void;
  bumpActivity: (id: string) => void;
  setZen: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setWallOpen: (v: boolean) => void;
  setReturnTo: (id: string | null) => void;
  setNow: (ms: number) => void;
  setRenamingId: (id: string | null) => void;
  setConfirmClose: (c: { id: string; name: string } | null) => void;
  setSearchOpen: (v: boolean) => void;
  setSearchHits: (h: SearchHit[]) => void;
  setInboxOpen: (v: boolean) => void;
  setTemplates: (t: Template[]) => void;
  setTemplatesOpen: (v: boolean) => void;
  setSparks: (s: Spark[]) => void;
  /** Apply a display order (list of ids) to the channels' `order` fields. */
  applyOrder: (orderedIds: string[]) => void;
  setSparksOpen: (v: boolean) => void;
  setCaptureFor: (c: { channelId: string; channelName: string; context?: string; prefill?: string } | null) => void;
  setToast: (t: string | null) => void;
}

const COLLAPSED_KEY = 'clack.sidebarCollapsed';
const WALL_KEY = 'clack.wall';
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* private mode / disabled storage — fine */
  }
}
const initialCollapsed = readFlag(COLLAPSED_KEY);

export const useStore = create<ClackState>((set) => ({
  channels: {},
  activeId: null,
  connected: false,
  everConnected: false,
  switcherOpen: false,
  newChannelOpen: false,
  lastActivity: {},
  zen: false,
  sidebarCollapsed: initialCollapsed,
  wallOpen: readFlag(WALL_KEY),
  returnTo: null,
  nowMs: 0,
  renamingId: null,
  confirmClose: null,
  searchOpen: false,
  searchHits: [],
  inboxOpen: false,
  templates: [],
  templatesOpen: false,
  sparks: [],
  sparksOpen: false,
  captureFor: null,
  toast: null,
  hello: (list) =>
    set((s) => {
      const channels: Record<string, ChannelInfo> = {};
      for (const ch of list) channels[ch.id] = ch;
      const activeId = s.activeId && channels[s.activeId] ? s.activeId : (byIdx(channels)[0]?.id ?? null);
      return { channels, activeId, connected: true, everConnected: true };
    }),
  upsert: (ch) => set((s) => ({ channels: { ...s.channels, [ch.id]: ch } })),
  remove: (id) =>
    set((s) => {
      const channels = { ...s.channels };
      delete channels[id];
      const activeId = s.activeId === id ? (byIdx(channels)[0]?.id ?? null) : s.activeId;
      return { channels, activeId, returnTo: s.returnTo === id ? null : s.returnTo };
    }),
  setActive: (id) => set({ activeId: id }),
  setConnected: (v) => set({ connected: v }),
  setSwitcherOpen: (v) => set({ switcherOpen: v }),
  setNewChannelOpen: (v) => set({ newChannelOpen: v }),
  bumpActivity: (id) => set((s) => ({ lastActivity: { ...s.lastActivity, [id]: Date.now() } })),
  setZen: (v) => set({ zen: v }),
  setSidebarCollapsed: (v) => {
    writeFlag(COLLAPSED_KEY, v);
    set({ sidebarCollapsed: v });
  },
  setReturnTo: (id) => set({ returnTo: id }),
  setWallOpen: (v) => {
    writeFlag(WALL_KEY, v);
    set({ wallOpen: v });
  },
  setNow: (ms) => set({ nowMs: ms }),
  setRenamingId: (id) => set({ renamingId: id }),
  setConfirmClose: (c) => set({ confirmClose: c }),
  setSearchOpen: (v) => set({ searchOpen: v, searchHits: v ? [] : [] }),
  setSearchHits: (h) => set({ searchHits: h }),
  setInboxOpen: (v) => set({ inboxOpen: v }),
  setTemplates: (t) => set({ templates: t }),
  setTemplatesOpen: (v) => set({ templatesOpen: v }),
  setSparks: (s) => set({ sparks: s }),
  applyOrder: (orderedIds) =>
    set((s) => {
      const channels = { ...s.channels };
      orderedIds.forEach((id, i) => {
        if (channels[id]) channels[id] = { ...channels[id], order: i };
      });
      return { channels };
    }),
  setSparksOpen: (v) => set({ sparksOpen: v }),
  setCaptureFor: (c) => set({ captureFor: c }),
  setToast: (t) => set({ toast: t }),
}));

/** Open (not-done) sparks for a channel — drives the sidebar 💡N badge. */
export function openSparkCount(sparks: Spark[], channelId: string): number {
  return sparks.reduce((n, s) => (s.channelId === channelId && !s.done ? n + 1 : n), 0);
}

/** Sidebar display order (user-reorderable); what the digit shortcuts map to.
 *  Falls back to idx when order ties (e.g. a just-arrived channel). */
export function byIdx(channels: Record<string, ChannelInfo>): ChannelInfo[] {
  return Object.values(channels).sort((a, b) => a.order - b.order || a.idx - b.idx);
}

/** Minutes-waited threshold for each escalation level (index = level 0..4). */
export const ESCALATION_MIN = [0, 5, 10, 20, 30];

/** How loud a waiting channel should look: 0 (subtle yellow) → 4 (flashing red). */
export function escalationLevel(waitingSince: number | undefined, nowMs: number): number {
  if (!waitingSince) return 0;
  const minutes = (nowMs - waitingSince) / 60000;
  let level = 0;
  for (let i = ESCALATION_MIN.length - 1; i >= 0; i--) {
    if (minutes >= ESCALATION_MIN[i]) {
      level = i;
      break;
    }
  }
  return level;
}

/**
 * Two tiers of attention:
 * - 'urgent': Claude is blocked (permission / bell) or the channel errored — act.
 * - 'ready':  Claude finished a turn, or is idle-waiting after answering — look when you like.
 * A plain answered question is 'ready' (calm green), never 'urgent' (red).
 */
export type AttnTier = 'urgent' | 'ready' | 'none';

export function tierOf(ch: ChannelInfo): AttnTier {
  if (ch.state === 'ERROR') return 'urgent';
  // waiting_input is Claude Code's idle reminder — a finished turn, not a block
  if (ch.state === 'NEEDS_INPUT') return ch.reason === 'waiting_input' ? 'ready' : 'urgent';
  if (ch.state === 'REVIEW') return 'ready';
  return 'none';
}

const bySince = (a: ChannelInfo, b: ChannelInfo) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0);

export function urgentChannels(channels: Record<string, ChannelInfo>): ChannelInfo[] {
  const err = Object.values(channels).filter((c) => c.state === 'ERROR').sort(bySince);
  const blocked = Object.values(channels).filter((c) => tierOf(c) === 'urgent' && c.state !== 'ERROR').sort(bySince);
  return [...err, ...blocked];
}

export function readyChannels(channels: Record<string, ChannelInfo>): ChannelInfo[] {
  return Object.values(channels)
    .filter((c) => tierOf(c) === 'ready')
    .sort(bySince);
}

/** Everything demanding attention, urgent first — drives the inbox walk. */
export function needsYou(channels: Record<string, ChannelInfo>): ChannelInfo[] {
  return [...urgentChannels(channels), ...readyChannels(channels)];
}

import { useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ChannelInfo } from '../../../shared/protocol';
import { useStore, byIdx, needsYou, escalationLevel } from '../store';
import {
  activateChannel,
  commitRename,
  createTerminal,
  openSparks,
  openWall,
  removeChannel,
  renameChannel,
  reorderChannels,
  toggleSidebar,
  toggleZen,
  visit,
} from '../actions';
import { kindOf, KIND_LABEL, ago, gist } from './wallParts';

/**
 * The wall, docked beside the terminal you're working in. Not a place to reply —
 * the real context is the session's own terminal. The dock's job is to say WHO
 * needs you and WHY, at a glance, then get you there and back: ⌃0 (or a click)
 * visits the session; ↩ (or ⌃0 once nothing's left) takes you home.
 */
export function Dock() {
  const channels = useStore((s) => s.channels);
  const now = useStore((s) => s.nowMs);
  const zen = useStore((s) => s.zen);
  const activeId = useStore((s) => s.activeId);
  const returnTo = useStore((s) => s.returnTo);
  const sparks = useStore((s) => s.sparks);
  const rows = byIdx(channels); // fixed order: a session is always where it was
  const waiting = new Set(needsYou(channels).map((c) => c.id));
  const openSparkTotal = sparks.reduce((n, s) => n + (s.done ? 0 : 1), 0);

  // drag-to-reorder: drop above/below the row under the pointer
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const drop = () => {
    if (dragId && over && dragId !== over.id) {
      const ids = rows.map((c) => c.id).filter((id) => id !== dragId);
      ids.splice(ids.indexOf(over.id) + (over.pos === 'after' ? 1 : 0), 0, dragId);
      reorderChannels(ids);
    }
    endDrag();
  };
  const dndFor = (ch: ChannelInfo): Dnd => ({
    over: dragId && dragId !== ch.id && over?.id === ch.id ? over.pos : null,
    dragging: dragId === ch.id,
    onDragStart: (e) => {
      e.dataTransfer.setData(REORDER_MIME, ch.id);
      e.dataTransfer.effectAllowed = 'move';
      setDragId(ch.id);
    },
    onDragOver: (e) => {
      if (!dragId) return; // not our drag (e.g. a file) — let it pass through
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      if (over?.id !== ch.id || over.pos !== pos) setOver({ id: ch.id, pos });
    },
    onDrop: (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      drop();
    },
    onDragEnd: endDrag,
  });

  return (
    <aside className="dock">
      <div className="sidebar-head">
        <div className="wordmark">
          clack<span className="blink-cursor">▊</span>
        </div>
        <span>
          <button className="icon-btn" title="full-screen wall (⌘⇧E)" onClick={openWall}>
            ⤢
          </button>
          <button className="icon-btn" title="collapse" onClick={toggleSidebar}>
            ‹
          </button>
        </span>
      </div>

      <div className="dock-scroll">
        {rows.map((ch, i) => (
          <DockRow
            key={ch.id}
            ch={ch}
            hotkey={i < 9 ? i + 1 : undefined}
            needs={waiting.has(ch.id)}
            here={ch.id === activeId}
            home={ch.id === returnTo}
            now={now}
            dnd={dndFor(ch)}
          />
        ))}
        {waiting.size > 0 && (
          <div className="dock-hint">
            <kbd>⌃0</kbd> visit the next one · <kbd>↩</kbd> in the top bar takes you back
          </div>
        )}
      </div>

      <div className="dock-foot">
        <button onClick={() => useStore.getState().setNewChannelOpen(true)}>+ channel</button>
        <button onClick={createTerminal} title="scratch shell for one-off commands">
          + terminal
        </button>
        <button onClick={openSparks} title="captured ideas — ⌘⇧I">
          💡{openSparkTotal > 0 ? ` ${openSparkTotal}` : ''}
        </button>
        <button onClick={() => useStore.getState().setTemplatesOpen(true)} title="save / launch channel sets">
          ⧉
        </button>
        <button className={zen ? 'on' : ''} onClick={toggleZen} title="⌘⇧Z — mute banners">
          {zen ? '● zen' : '○ zen'}
        </button>
      </div>
    </aside>
  );
}

/** Custom drag type so the window-level file-drop handler ignores reorder drags. */
const REORDER_MIME = 'application/x-clack-reorder';

interface Dnd {
  dragging: boolean;
  over: 'before' | 'after' | null;
  onDragStart: (e: ReactDragEvent) => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
  onDragEnd: () => void;
}

function DockRow({
  ch,
  hotkey,
  needs,
  here,
  home,
  now,
  dnd,
}: {
  ch: ChannelInfo;
  hotkey?: number;
  needs: boolean;
  here: boolean;
  /** You're visiting elsewhere; this is where answering will bring you back to. */
  home: boolean;
  now: number;
  dnd: Dnd;
}) {
  const renaming = useStore((s) => s.renamingId === ch.id);
  const k = kindOf(ch);
  const lvl = needs ? escalationLevel(ch.waitingSince, now) : 0;
  // a session waiting on you is a round trip; anything else is a plain switch
  const open = () => (needs && !here ? visit(ch.id) : activateChannel(ch.id));
  // A draggable row swallows clicks on its buttons whenever the mouse drifts a
  // pixel (the browser starts a drag instead) — that's why × used to take 2–3
  // tries. Decide per press: pressing a button never arms the drag.
  const armDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.draggable = !renaming && !(e.target as HTMLElement).closest('button, input');
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'drow',
        `k-${k}`,
        needs ? 'needs' : '',
        here ? 'here' : '',
        `esc-${lvl}`,
        dnd.dragging ? 'dragging' : '',
        dnd.over ? `drop-${dnd.over}` : '',
      ].join(' ')}
      title={ch.cwd.replace(/^\/Users\/[^/]+/, '~')}
      onPointerDown={armDrag}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDrop={dnd.onDrop}
      onDragEnd={dnd.onDragEnd}
      onClick={open}
      onDoubleClick={() => renameChannel(ch.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
    >
      <span className="drow-top">
        <i className="drow-dot" />
        {renaming ? <RenameInput ch={ch} /> : <span className="drow-name">{ch.name}</span>}
        {home && <span className="drow-home">↩ home</span>}
        <span className="drow-state">
          {KIND_LABEL[k]}
          {needs && ch.waitingSince ? ` · ${ago(ch.waitingSince, now)}` : ''}
        </span>
        {hotkey != null && <span className="drow-key">{hotkey}</span>}
        <button
          className="drow-close"
          title="close channel"
          onClick={(e) => {
            e.stopPropagation();
            removeChannel(ch.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          ×
        </button>
      </span>
      <span className="drow-gist">{gist(ch)}</span>
    </div>
  );
}

function RenameInput({ ch }: { ch: ChannelInfo }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false); // guards against the unmount blur double-firing
  const [val, setVal] = useState(ch.name);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  // save=false (Escape) must NOT commit, even though clearing the input blurs it
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) commitRename(ch.id, val);
    else useStore.getState().setRenamingId(null);
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      value={val}
      spellCheck={false}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)} // clicking away saves
    />
  );
}

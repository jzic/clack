import { useEffect, useRef, useState } from 'react';
import type { ChannelInfo } from '../../../shared/protocol';
import { useStore, byIdx, needsYou } from '../store';
import { activateChannel, dismissChannel, replyTo, toggleWall, toggleZen } from '../actions';
import { Tile, HandoffCard, kindOf, canReply, KIND_LABEL, type Kind } from './wallParts';

/**
 * The wall: the answer to "what's going on?" without opening anything.
 * Top — every session as a tile in a FIXED position (spatial memory: a session
 * never moves), colored by state. Bottom — the sessions that handed work
 * back to you, as cards carrying Claude's actual closing words and a reply box.
 * The Dock is the same thing squeezed beside the terminal; this is the sweep view.
 */
export function Wall() {
  const channels = useStore((s) => s.channels);
  const now = useStore((s) => s.nowMs);
  const zen = useStore((s) => s.zen);
  const tiles = byIdx(channels).filter((c) => !c.shell);
  const queue = needsYou(channels).filter((c) => !c.shell);
  const [selId, setSelId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const replyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  /** When a reply sends, the next card's box takes focus — answer, answer, answer. */
  const chainFocus = useRef(false);

  // keep the selection on a card that still exists; fall back to the queue head
  const sel = queue.find((c) => c.id === selId) ?? queue[0];
  const selIdx = sel ? queue.indexOf(sel) : -1;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (chainFocus.current && sel && canReply(sel)) {
      chainFocus.current = false;
      replyRefs.current[sel.id]?.focus();
    }
  }, [sel?.id]);

  const select = (id: string, focusReply = false) => {
    setSelId(id);
    document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (focusReply) requestAnimationFrame(() => replyRefs.current[id]?.focus());
  };

  const send = (ch: ChannelInfo) => {
    const text = drafts[ch.id] ?? '';
    if (!text.trim()) return;
    replyTo(ch.id, text);
    setDrafts((d) => ({ ...d, [ch.id]: '' }));
    const next = queue[selIdx + 1] ?? queue[selIdx - 1];
    chainFocus.current = true;
    setSelId(next && next.id !== ch.id ? next.id : null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const move = (d: number) => {
      if (!queue.length) return;
      const i = selIdx === -1 ? 0 : (selIdx + d + queue.length) % queue.length;
      select(queue[i].id);
    };
    const handled = (() => {
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          move(1);
          return true;
        case 'k':
        case 'ArrowUp':
          move(-1);
          return true;
        case 'Enter':
        case 'r':
          if (sel && canReply(sel)) select(sel.id, true);
          else if (sel) activateChannel(sel.id);
          return true;
        case 'o':
          if (sel) activateChannel(sel.id);
          return true;
        case 's':
          if (sel) dismissChannel(sel.id);
          return true;
      }
      if (/^[1-9]$/.test(e.key)) {
        const t = tiles[Number(e.key) - 1];
        if (t) activateChannel(t.id);
        return true;
      }
      return false;
    })();
    if (handled) e.preventDefault();
  };

  const counts = tiles.reduce<Record<string, number>>((m, c) => {
    const k = kindOf(c);
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  const yourTurn = queue.length;

  return (
    <div className="wall" ref={rootRef} tabIndex={-1} onKeyDown={onKey}>
      <header className="wall-head">
        <div className="wordmark">
          clack<span className="blink-cursor">▊</span>
        </div>
        <div className="wall-counts">
          {(['crashed', 'blocked', 'asks', 'done', 'working', 'idle'] as Kind[])
            .filter((k) => counts[k])
            .map((k) => (
              <span key={k} className={`wall-count k-${k}`}>
                <i />
                {counts[k]} {KIND_LABEL[k]}
              </span>
            ))}
        </div>
        <div className="wall-head-actions">
          <button className={zen ? 'on' : ''} onClick={toggleZen} title="zen: mute banners (⌘⇧Z)">
            {zen ? '◐ zen on' : '◐ zen'}
          </button>
          <button onClick={toggleWall} title="back to the terminal (⌘⇧E)">
            terminal <kbd>⌘⇧E</kbd>
          </button>
        </div>
      </header>

      <div className="wall-grid">
        {tiles.map((ch, i) => {
          const inQueue = queue.includes(ch);
          return (
            <Tile
              key={ch.id}
              ch={ch}
              hotkey={i < 9 ? i + 1 : undefined}
              inQueue={inQueue}
              selected={sel?.id === ch.id}
              now={now}
              onClick={() => (inQueue ? select(ch.id, canReply(ch)) : activateChannel(ch.id))}
            />
          );
        })}
      </div>

      <section className="wall-queue">
        <div className="wall-queue-label">
          your turn {yourTurn > 0 && <span className="wall-queue-n">{yourTurn}</span>}
          <span className="wall-hints">
            <kbd>j</kbd>
            <kbd>k</kbd> move · <kbd>⏎</kbd> reply · <kbd>o</kbd> open terminal · <kbd>s</kbd> seen ·{' '}
            <kbd>1–9</kbd> jump
          </span>
        </div>

        {yourTurn === 0 && (
          <div className="wall-empty">
            <div className="wall-empty-mark">✓</div>
            nothing is waiting on you.
            <span>{counts.working ? `${counts.working} working — they'll show up here when they're done.` : ''}</span>
          </div>
        )}

        {queue.map((ch) => (
          <HandoffCard
            key={ch.id}
            ch={ch}
            now={now}
            selected={sel?.id === ch.id}
            draft={drafts[ch.id] ?? ''}
            onDraft={(t) => setDrafts((d) => ({ ...d, [ch.id]: t }))}
            onSend={() => send(ch)}
            onSelect={() => setSelId(ch.id)}
            onEscape={() => rootRef.current?.focus()}
            replyRef={(el) => {
              replyRefs.current[ch.id] = el;
            }}
          />
        ))}
      </section>
    </div>
  );
}

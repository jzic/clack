import { useEffect, useRef } from 'react';
import { useStore, needsYou, tierOf } from '../store';
import { inboxStep } from '../actions';

/** Slim triage bar: walks you through the needs-you queue in context. */
export function InboxBar() {
  const open = useStore((s) => s.inboxOpen);
  const channels = useStore((s) => s.channels);
  const activeId = useStore((s) => s.activeId);
  const queue = needsYou(channels);
  const clearedTimer = useRef<number | undefined>(undefined);

  // once the queue empties, linger on "all caught up" briefly, then close
  useEffect(() => {
    window.clearTimeout(clearedTimer.current);
    if (open && queue.length === 0) {
      clearedTimer.current = window.setTimeout(() => useStore.getState().setInboxOpen(false), 2200);
    }
    return () => window.clearTimeout(clearedTimer.current);
  }, [open, queue.length]);

  if (!open) return null;

  const close = () => useStore.getState().setInboxOpen(false);

  if (queue.length === 0) {
    return (
      <div className="inbox-bar cleared">
        <span className="inbox-check">✓</span> all caught up — nothing needs you
        <button className="inbox-x" onClick={close} title="close">
          ×
        </button>
      </div>
    );
  }

  const pos = queue.findIndex((c) => c.id === activeId);
  const current = pos === -1 ? queue[0] : queue[pos];
  const ask = askOf(current);

  return (
    <div className="inbox-bar">
      <span className="inbox-label">needs you</span>
      <span className="inbox-count">
        {pos === -1 ? 1 : pos + 1}/{queue.length}
      </span>
      <span className="inbox-current">
        <span
          className={`inbox-dot ${current.state === 'ERROR' ? 'err' : tierOf(current) === 'ready' ? 'ready' : ''}`}
        />
        #{current.name}
      </span>
      <span className="inbox-ask">{ask}</span>
      <span className="inbox-actions">
        <button onClick={() => inboxStep(-1)} title="previous">
          ‹
        </button>
        <button onClick={() => inboxStep(1)} title="next (or ⌘0)">
          next ›
        </button>
        <button className="inbox-x" onClick={close} title="close">
          ×
        </button>
      </span>
    </div>
  );
}

function askOf(ch: ReturnType<typeof needsYou>[number]): string {
  if (ch.state === 'ERROR') return ch.exitCode != null ? `exited · code ${ch.exitCode}` : 'exited unexpectedly';
  if (ch.state === 'REVIEW') return ch.title.trim() || 'finished — ready for review';
  if (ch.reason === 'permission') {
    const m = ch.attentionMessage?.trim().replace(/^Claude\s+/i, '');
    return m || 'waiting for permission';
  }
  if (ch.reason === 'bell') return 'may need you';
  return 'waiting on you in the terminal';
}

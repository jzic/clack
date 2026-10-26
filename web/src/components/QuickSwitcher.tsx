import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelInfo, ChannelState } from '../../../shared/protocol';
import { useStore, byIdx } from '../store';
import { activateChannel } from '../actions';
import { termRegistry } from '../termRegistry';

const STATE_RANK: Record<ChannelState, number> = {
  ERROR: 0,
  NEEDS_INPUT: 1,
  REVIEW: 2,
  WORKING: 3,
  CLAUDE_IDLE: 4,
  NO_CLAUDE: 5,
};

/** Simple subsequence match; consecutive hits score higher. -1 = no match. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

export function QuickSwitcher() {
  const open = useStore((s) => s.switcherOpen);
  const channels = useStore((s) => s.channels);
  const lastActivity = useStore((s) => s.lastActivity);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(
    () =>
      byIdx(channels)
        .map((ch) => ({
          ch,
          score: Math.max(fuzzyScore(query, ch.name), fuzzyScore(query, ch.cwd), fuzzyScore(query, ch.title)),
        }))
        .filter((r) => r.score >= 0)
        .sort(
          (a, b) =>
            STATE_RANK[a.ch.state] - STATE_RANK[b.ch.state] ||
            b.score - a.score ||
            (lastActivity[b.ch.id] ?? 0) - (lastActivity[a.ch.id] ?? 0),
        )
        .map((r) => r.ch),
    [channels, query, lastActivity],
  );

  if (!open) return null;

  const close = () => {
    useStore.getState().setSwitcherOpen(false);
    termRegistry.focusActive();
  };
  const pick = (ch: ChannelInfo) => {
    useStore.getState().setSwitcherOpen(false);
    activateChannel(ch.id);
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="jump to channel…"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (results[sel]) pick(results[sel]);
            } else if (!query && e.key >= '1' && e.key <= '9') {
              const ch = results[Number(e.key) - 1];
              if (ch) {
                e.preventDefault();
                pick(ch);
              }
            }
          }}
        />
        <div className="switcher-list">
          {results.map((ch, i) => (
            <div
              key={ch.id}
              className={`switcher-row ${i === sel ? 'selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(ch)}
            >
              <StatusTag state={ch.state} />
              <span className="sw-name">#{ch.name}</span>
              <span className="sw-sub">{ch.title.trim() || ch.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
            </div>
          ))}
          {!results.length && <div className="switcher-empty">no matches</div>}
        </div>
      </div>
    </div>
  );
}

function StatusTag({ state }: { state: ChannelState }) {
  const cls =
    state === 'ERROR'
      ? 'error'
      : state === 'NEEDS_INPUT'
        ? 'needs'
        : state === 'REVIEW'
          ? 'review'
          : state === 'WORKING'
            ? 'working'
            : 'idle';
  const label =
    state === 'ERROR' ? '■' : state === 'NEEDS_INPUT' ? '!' : state === 'REVIEW' ? '✓' : state === 'WORKING' ? '…' : '·';
  return <span className={`sw-tag sw-${cls}`}>{label}</span>;
}

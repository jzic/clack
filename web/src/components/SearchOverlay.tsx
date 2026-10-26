import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { socket } from '../socket';
import { activateChannel } from '../actions';
import { termRegistry } from '../termRegistry';

/** Cross-channel scrollback search (Cmd/Ctrl+Shift+F). */
export function SearchOverlay() {
  const open = useStore((s) => s.searchOpen);
  const hits = useStore((s) => s.searchHits);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      useStore.getState().setSearchHits([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // debounce the query -> server
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => socket.send({ type: 'search', query }), 140);
    return () => clearTimeout(t);
  }, [query, open]);

  const flat = useMemo(() => hits.map((h) => h.id), [hits]);
  useEffect(() => setSel((s) => Math.min(s, Math.max(0, flat.length - 1))), [flat.length]);

  if (!open) return null;

  const close = () => {
    useStore.getState().setSearchOpen(false);
    termRegistry.focusActive();
  };
  const jump = (id: string) => {
    close();
    activateChannel(id);
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="switcher search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-head">
          <span className="search-icon">⌕</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="search all channels…"
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
                setSel((s) => Math.min(s + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter' && hits[sel]) {
                e.preventDefault();
                jump(hits[sel].id);
              }
            }}
          />
        </div>
        <div className="switcher-list">
          {hits.map((h, i) => (
            <div
              key={h.id}
              className={`search-hit ${i === sel ? 'selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => jump(h.id)}
            >
              <div className="search-hit-head">
                <span className="sw-name">#{h.name}</span>
                <span className="search-count">
                  {h.count} match{h.count === 1 ? '' : 'es'}
                </span>
              </div>
              {h.snippets.map((s, j) => (
                <div key={j} className="search-snippet">
                  {highlight(s, query)}
                </div>
              ))}
            </div>
          ))}
          {query.trim().length >= 2 && hits.length === 0 && <div className="switcher-empty">no matches</div>}
          {query.trim().length < 2 && <div className="switcher-empty">type at least 2 characters</div>}
        </div>
      </div>
    </div>
  );
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const parts: React.ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let idx = lower.indexOf(ql);
  let key = 0;
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="search-mark">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(ql, i);
  }
  parts.push(text.slice(i));
  return parts;
}

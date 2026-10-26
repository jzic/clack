import { useRef, useState } from 'react';
import { useStore } from '../store';
import { termRegistry } from '../termRegistry';
import { toggleSparkDone, deleteSpark, promoteSpark, editSpark } from '../actions';
import type { Spark } from '../../../shared/protocol';

interface Group {
  channelId: string;
  channelName: string;
  openCount: number;
  items: Spark[];
  latest: number;
}

/** The Sparks inbox (⌘⇧I) — captured ideas grouped by channel, open first. */
export function SparksOverlay() {
  const open = useStore((s) => s.sparksOpen);
  const sparks = useStore((s) => s.sparks);
  const channels = useStore((s) => s.channels);
  const nowMs = useStore((s) => s.nowMs);

  if (!open) return null;

  const close = () => {
    useStore.getState().setSparksOpen(false);
    termRegistry.focusActive();
  };

  const groups = groupByChannel(sparks);
  const openTotal = sparks.reduce((n, s) => n + (s.done ? 0 : 1), 0);

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="sparks-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sparks-head">
          <span className="sparks-title">
            <span className="sparks-glyph">💡</span> sparks
          </span>
          <span className="sparks-sub">
            {openTotal === 0 ? 'ideas to revisit' : `${openTotal} open · ideas to revisit`}
          </span>
          <button className="sparks-x" title="close" onClick={close}>
            ×
          </button>
        </div>
        <div className="sparks-body">
          {groups.length === 0 ? (
            <div className="sparks-empty">
              No sparks yet.
              <br />
              Highlight something and press <kbd>⌘I</kbd> to save it — or <kbd>⌘I</kbd> with nothing selected to jot one.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.channelId} className="sparks-group">
                <div className="sparks-group-head">
                  <span className="sparks-group-name">#{channels[g.channelId]?.name ?? g.channelName}</span>
                  {g.openCount > 0 && <span className="sparks-group-count">{g.openCount}</span>}
                  {!channels[g.channelId] && <span className="sparks-gone">closed</span>}
                </div>
                {g.items.map((s) => (
                  <SparkRow key={s.id} spark={s} nowMs={nowMs} live={!!channels[s.channelId]} />
                ))}
              </div>
            ))
          )}
        </div>
        <div className="sparks-foot">
          <kbd>⌘I</kbd> capture · <kbd>→</kbd> promote · <kbd>✓</kbd> done · <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}

function SparkRow({ spark, nowMs, live }: { spark: Spark; nowMs: number; live: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(spark.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setDraft(spark.text);
    setEditing(true);
    setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length); // cursor at end, ready to append
      }
    }, 0);
  };
  const save = () => {
    editSpark(spark.id, draft);
    setEditing(false);
  };

  if (editing) {
    const rows = Math.min(14, Math.max(2, draft.split('\n').length + 1));
    return (
      <div className="spark spark-editing">
        <textarea
          ref={ref}
          className="spark-editor"
          value={draft}
          rows={rows}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
        <div className="spark-edit-hint">Enter saves · Shift+Enter newline · Esc cancels</div>
      </div>
    );
  }

  return (
    <div className={`spark ${spark.done ? 'spark-done' : ''}`}>
      <button
        className={`spark-check ${spark.done ? 'on' : ''}`}
        title={spark.done ? 'mark open' : 'mark done'}
        onClick={() => toggleSparkDone(spark.id)}
      >
        {spark.done ? '✓' : '○'}
      </button>
      <div className="spark-text" onDoubleClick={startEdit} title="double-click to edit">
        <div className="spark-body">{spark.text}</div>
        <div className="spark-meta">
          {ago(nowMs, spark.createdAt)}
          {spark.context ? ` · ${spark.context}` : ''}
        </div>
      </div>
      <div className="spark-actions">
        <button className="spark-edit" title="edit / add your take" onClick={startEdit}>
          ✎
        </button>
        {live && !spark.done && (
          <button className="spark-promote" title="send it to this channel's prompt" onClick={() => promoteSpark(spark)}>
            →
          </button>
        )}
        <button className="spark-del" title="delete" onClick={() => deleteSpark(spark.id)}>
          ×
        </button>
      </div>
    </div>
  );
}

/** Group by channel; open sparks before done, newest first; groups by most-recent activity. */
function groupByChannel(sparks: Spark[]): Group[] {
  const map = new Map<string, Spark[]>();
  for (const s of sparks) {
    const arr = map.get(s.channelId);
    if (arr) arr.push(s);
    else map.set(s.channelId, [s]);
  }
  const groups: Group[] = [];
  for (const [channelId, items] of map) {
    items.sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.createdAt - a.createdAt);
    groups.push({
      channelId,
      channelName: items[0].channelName,
      openCount: items.reduce((n, s) => n + (s.done ? 0 : 1), 0),
      items,
      latest: items.reduce((m, s) => Math.max(m, s.createdAt), 0),
    });
  }
  return groups.sort((a, b) => b.latest - a.latest);
}

function ago(now: number, then: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

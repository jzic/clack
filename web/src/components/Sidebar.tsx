import type { ChannelInfo } from '../../../shared/protocol';
import { useStore, byIdx, tierOf, escalationLevel } from '../store';
import { activateChannel, toggleZen, toggleSidebar, openWall } from '../actions';
import { Dock } from './Dock';

export function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  return collapsed ? <CollapsedRail /> : <Dock />;
}

/** Narrow rail: just the escalation dots, so you can still glance at what's
 *  waiting (and how urgently) without the full bar. Default look in zen mode. */
function CollapsedRail() {
  const channels = useStore((s) => s.channels);
  const zen = useStore((s) => s.zen);
  const ordered = byIdx(channels);
  return (
    <aside className="rail">
      <button className="icon-btn rail-expand" title="expand channel bar" onClick={toggleSidebar}>
        ›
      </button>
      <button className="icon-btn" title="the wall (⌘⇧E)" onClick={openWall}>
        ▦
      </button>
      <div className="rail-dots">
        {ordered.map((ch) => (
          <RailDot key={ch.id} ch={ch} />
        ))}
      </div>
      <button className={`icon-btn zen-dot ${zen ? 'on' : ''}`} onClick={toggleZen} title="⌘⇧Z — zen mode">
        {zen ? '●' : '○'}
      </button>
    </aside>
  );
}

function RailDot({ ch }: { ch: ChannelInfo }) {
  const isActive = useStore((s) => s.activeId === ch.id);
  const nowMs = useStore((s) => s.nowMs);
  const zen = useStore((s) => s.zen);
  const tier = tierOf(ch);
  const level = tier === 'urgent' && ch.state !== 'ERROR' ? escalationLevel(ch.waitingSince, nowMs) : -1;
  const hint = tier === 'urgent' ? ' — needs you' : tier === 'ready' ? ' — ready' : '';
  return (
    <button
      className={`rail-dot ${isActive ? 'active' : ''} ${zen ? 'zen' : ''}`}
      title={`#${ch.name}${hint}`}
      onClick={() => activateChannel(ch.id)}
    >
      <StatusGlyph ch={ch} level={level} />
    </button>
  );
}

/** level: -1 = not an escalating state; 0..4 = escalation tier (urgent only). */
function StatusGlyph({ ch, level }: { ch: ChannelInfo; level: number }) {
  if (ch.state === 'ERROR') return <span className="glyph glyph-error">■</span>;
  if (!ch.ptyAlive) return <span className="glyph glyph-dead">×</span>;
  const tier = tierOf(ch);
  if (tier === 'urgent') return <span className={`dot dot-attn esc-${level}`} />;
  if (tier === 'ready') return <span className="dot dot-ready" />;
  if (ch.state === 'WORKING')
    return (
      <span className="typing" role="img" aria-label="working">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
    );
  if (ch.shell) return <span className="glyph glyph-shell">$</span>;
  return <span className={ch.unread ? 'dot dot-unread' : 'dot dot-idle'} />;
}

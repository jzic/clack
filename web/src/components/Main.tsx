import type { ChannelState } from '../../../shared/protocol';
import { useStore, needsYou } from '../store';
import { respawnChannel, returnHome, visitNext } from '../actions';
import { TerminalHost } from './TerminalHost';
import { InboxBar } from './InboxBar';

const STATE_LABEL: Record<ChannelState, string> = {
  NO_CLAUDE: 'shell',
  CLAUDE_IDLE: 'claude idle',
  WORKING: 'working',
  NEEDS_INPUT: 'needs you',
  REVIEW: 'review',
  ERROR: 'error',
};

export function Main() {
  const active = useStore((s) => (s.activeId ? s.channels[s.activeId] : undefined));
  const hasChannels = useStore((s) => Object.keys(s.channels).length > 0);
  const home = useStore((s) => (s.returnTo ? s.channels[s.returnTo] : undefined));
  const moreWaiting = useStore((s) => needsYou(s.channels).filter((c) => c.id !== s.activeId).length);

  if (!hasChannels) {
    return (
      <main className="main">
        <EmptyState />
      </main>
    );
  }

  return (
    <main className="main">
      {active && (
        <header className="topbar">
          <span className="topbar-name">#{active.name}</span>
          <span className={`pill pill-${active.state.toLowerCase()}`}>
            {STATE_LABEL[active.state]}
            {active.state === 'NEEDS_INPUT' && active.reason ? ` · ${active.reason.replace('_', ' ')}` : ''}
            {active.state === 'ERROR' && active.exitCode != null ? ` · code ${active.exitCode}` : ''}
          </span>
          <span className="topbar-title">{active.title}</span>
          <span className="topbar-cwd">
            <bdi>{active.cwd.replace(/^\/Users\/[^/]+/, '~')}</bdi>
          </span>
          {home && (
            // visiting a waiting session: hop back when you're done (never automatic)
            <span className="visit-bar">
              {moreWaiting > 0 && (
                <button onClick={visitNext} title="next session waiting on you (⌃0)">
                  {moreWaiting} more waiting <kbd>⌃0</kbd>
                </button>
              )}
              <button className="visit-home" onClick={returnHome} title="back to where you were">
                ↩ #{home.name}
              </button>
            </span>
          )}
        </header>
      )}
      <InboxBar />
      <div className="term-area">
        <TerminalHost />
        {active && !active.ptyAlive && (
          <div className={`dead-bar${active.state === 'ERROR' ? ' dead-bar-error' : ''}`}>
            <span>
              {active.state === 'ERROR'
                ? `exited unexpectedly${active.exitCode != null ? ` · code ${active.exitCode}` : ''}`
                : 'shell exited'}
            </span>
            <button onClick={() => respawnChannel(active.id, false)}>restart shell</button>
            <button className="primary" onClick={() => respawnChannel(active.id, true)}>
              restart + claude --continue
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-mark">
        clack<span className="blink-cursor">▊</span>
      </div>
      <p className="empty-tag">
        every terminal becomes a channel.
        <br />
        one window. nothing missed.
      </p>
      <button className="primary" onClick={() => useStore.getState().setNewChannelOpen(true)}>
        + create your first channel
      </button>
      <div className="empty-hints">
        <span>
          <kbd>⌘K</kbd> quick switch
        </span>
        <span>
          <kbd>⌃1–9</kbd> jump to channel
        </span>
        <span>
          <kbd>⌃0</kbd> jump to needs-you
        </span>
      </div>
    </div>
  );
}

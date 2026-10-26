import type { ChannelInfo } from '../../../shared/protocol';
import { escalationLevel } from '../store';
import { activateChannel, dismissChannel } from '../actions';

/** Shared pieces of the wall: the full-screen view (Wall) and the side dock (Dock). */

export type Kind = 'crashed' | 'blocked' | 'asks' | 'done' | 'working' | 'idle' | 'off' | 'shell';

export function kindOf(ch: ChannelInfo): Kind {
  if (ch.shell) return 'shell';
  switch (ch.state) {
    case 'ERROR':
      return 'crashed';
    case 'NEEDS_INPUT':
      // the idle reminder is a finished turn, not a block; permission/bell are real blocks
      return ch.reason === 'waiting_input' ? 'done' : 'blocked';
    case 'REVIEW':
      return ch.handoff?.kind === 'asks' ? 'asks' : 'done';
    case 'WORKING':
      return 'working';
    case 'CLAUDE_IDLE':
      return 'idle';
    default:
      return ch.ptyAlive ? 'idle' : 'off';
  }
}

export const KIND_LABEL: Record<Kind, string> = {
  crashed: 'crashed',
  blocked: 'blocked',
  asks: 'asks you',
  done: 'done',
  working: 'working',
  idle: 'idle',
  off: 'off',
  shell: 'shell',
};

/** A card's reply box is live only when Claude has finished its turn and sits at its prompt. */
export const canReply = (ch: ChannelInfo) => kindOf(ch) === 'asks' || kindOf(ch) === 'done';

/** Terminal titles carry Claude's spinner glyph; the words are what matter. */
const cleanTitle = (t: string) => t.replace(/^[^\p{L}\p{N}]+/u, '').trim();

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/[*_`#>]/g, '').trim();
}

export function ago(since: number | undefined, now: number): string {
  if (!since) return '';
  const m = Math.floor((now - since) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

function cardBody(ch: ChannelInfo): string {
  const k = kindOf(ch);
  if (k === 'crashed') return `Exited unexpectedly${ch.exitCode != null ? ` (code ${ch.exitCode})` : ''}.`;
  if (k === 'blocked')
    return (
      (ch.attentionMessage ??
        (ch.reason === 'bell'
          ? 'Rang the bell — may need you.'
          : ch.reason === 'permission'
            ? 'Needs permission.'
            : 'Stopped mid-turn to ask you something.')) + '\n\nAnswer it in the terminal.'
    );
  if (ch.handoff) return ch.handoff.text;
  return cleanTitle(ch.title) || 'Finished a turn.';
}

const stripMd = (t: string) =>
  t
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What a dock row says. For a session that needs you: the actual ask — the
 * question it ended on, the permission it wants — so you know WHY before you go.
 * Otherwise: what it's doing now, or the last thing it said.
 */
export function gist(ch: ChannelInfo): string {
  const k = kindOf(ch);
  if (k === 'crashed') return `exited unexpectedly${ch.exitCode != null ? ` · code ${ch.exitCode}` : ''}`;
  if (k === 'blocked') {
    const m = ch.attentionMessage?.replace(/^Claude\s+/i, '');
    return (
      m ||
      (ch.reason === 'bell'
        ? 'rang the bell'
        : ch.reason === 'permission'
          ? 'needs permission'
          : 'stopped to ask you something')
    );
  }
  if (k === 'working') return cleanTitle(ch.title) || 'working…';
  if (ch.handoff) {
    const paras = ch.handoff.text.split(/\n\s*\n/).filter((p) => p.trim());
    // asks: the question (its last paragraph); done: the opening line, then the rest
    return stripMd(k === 'asks' ? paras[paras.length - 1] : paras.join(' '));
  }
  return cleanTitle(ch.title) || tildify(ch.cwd);
}

/** The tile's one line: what it's doing now, or the last thing it said. */
function tileLine(ch: ChannelInfo): string {
  if (ch.state === 'WORKING') return cleanTitle(ch.title) || 'working…';
  if (ch.handoff) return firstLine(ch.handoff.text);
  return cleanTitle(ch.title) || tildify(ch.cwd);
}

export function Tile({
  ch,
  hotkey,
  inQueue,
  selected,
  now,
  onClick,
}: {
  ch: ChannelInfo;
  hotkey?: number;
  inQueue: boolean;
  selected?: boolean;
  now: number;
  onClick: () => void;
}) {
  const k = kindOf(ch);
  const lvl = inQueue ? escalationLevel(ch.waitingSince, now) : 0;
  return (
    <button
      className={`tile k-${k}${inQueue ? ' needs' : ''}${selected ? ' sel' : ''} esc-${lvl}`}
      title={`${tildify(ch.cwd)}\n${inQueue ? 'click: jump to its card · double-click: open terminal' : 'click: open terminal'}`}
      onClick={onClick}
      onDoubleClick={() => activateChannel(ch.id)}
    >
      <span className="tile-top">
        <span className="tile-name">{ch.name}</span>
        {hotkey != null && <span className="tile-key">{hotkey}</span>}
      </span>
      <span className="tile-state">
        <i />
        {KIND_LABEL[k]}
        {inQueue && <span className="tile-age">{ago(ch.waitingSince, now)}</span>}
      </span>
      <span className="tile-line">{tileLine(ch)}</span>
    </button>
  );
}

export function HandoffCard({
  ch,
  now,
  selected,
  draft,
  onDraft,
  onSend,
  onSelect,
  onEscape,
  replyRef,
}: {
  ch: ChannelInfo;
  now: number;
  selected: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onSelect: () => void;
  onEscape?: () => void;
  replyRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const k = kindOf(ch);
  const lvl = escalationLevel(ch.waitingSince, now);
  const replyable = canReply(ch);
  const actions = (
    <>
      <button className={replyable ? '' : 'primary'} onClick={() => activateChannel(ch.id)}>
        open terminal
      </button>
      <button onClick={() => dismissChannel(ch.id)} title="seen — clear it without replying">
        seen
      </button>
    </>
  );
  return (
    <article id={`card-${ch.id}`} className={`card k-${k}${selected ? ' sel' : ''}`} onClick={onSelect}>
      <div className="card-head">
        <span className="card-name">#{ch.name}</span>
        <span className={`card-kind k-${k}`}>{KIND_LABEL[k]}</span>
        <span className={`card-age esc-${lvl}`}>{ago(ch.waitingSince, now)}</span>
        <span className="card-cwd">
          <bdi>{tildify(ch.cwd)}</bdi>
        </span>
      </div>
      <div className="card-body">{cardBody(ch)}</div>
      <div className="card-foot">
        {replyable ? (
          <textarea
            ref={replyRef}
            className="card-reply"
            rows={Math.min(6, Math.max(1, draft.split('\n').length))}
            placeholder={`reply to #${ch.name}…   ⏎ send · ⇧⏎ newline · esc`}
            value={draft}
            onFocus={onSelect}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSend();
              } else if (e.key === 'Escape' && onEscape) {
                e.preventDefault();
                onEscape();
              }
            }}
          />
        ) : (
          <span className="card-noreply">
            {k === 'crashed' ? 'restart it from the terminal' : 'answer this in the terminal'}
          </span>
        )}
        {actions}
      </div>
    </article>
  );
}

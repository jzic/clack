// Wire contract between clack-server and the web UI.
//
// Terminal bytes travel as binary WS frames: [u8 msgType][u8 channelIdx][payload].
// Everything else is JSON text frames (ServerMsg / ClientMsg).

export const MSG_OUTPUT = 0x01; // server -> client: terminal output
export const MSG_INPUT = 0x02; // client -> server: keystrokes

export type ChannelState = 'NO_CLAUDE' | 'CLAUDE_IDLE' | 'WORKING' | 'NEEDS_INPUT' | 'REVIEW' | 'ERROR';
export type NeedsReason = 'permission' | 'waiting_input' | 'bell';

/** Claude's closing words for its last turn — what it did, and whether it's asking you something. */
export interface Handoff {
  text: string;
  /** 'asks' = the turn ends on a question for you; 'done' = it just finished. */
  kind: 'asks' | 'done';
  at: number;
}

export interface ChannelInfo {
  id: string;
  /** Small int used as the channel byte in binary frames; stable for the server's lifetime. */
  idx: number;
  /** Display order in the sidebar (user-reorderable). Distinct from idx, which is the wire id. */
  order: number;
  name: string;
  cwd: string;
  autostart?: string;
  /** A scratch terminal (created via "+ terminal") — no Claude, never badges. */
  shell?: boolean;
  state: ChannelState;
  reason?: NeedsReason;
  /** The actual ask when NEEDS_INPUT, from the Notification hook. */
  attentionMessage?: string;
  unread: boolean;
  title: string;
  /** Epoch ms since the channel started needing attention (NEEDS_INPUT/REVIEW/ERROR). */
  waitingSince?: number;
  /** Exit/crash code when state is ERROR. */
  exitCode?: number;
  ptyAlive: boolean;
  /** Last turn's handoff; cleared when you send the next prompt. */
  handoff?: Handoff;
}

export interface SearchHit {
  id: string;
  name: string;
  count: number;
  snippets: string[];
}

export interface TemplateChannel {
  name: string;
  cwd: string;
  autostart?: string;
  shell?: boolean;
}

export interface Template {
  name: string;
  channels: TemplateChannel[];
}

/** A captured idea/tangent worth revisiting — the "Sparks" inbox. Human-authored. */
export interface Spark {
  id: string;
  channelId: string;
  /** Snapshot of the channel name at capture time (fallback if the channel is gone/renamed). */
  channelName: string;
  text: string;
  createdAt: number;
  /** The channel's live title when captured — "why this mattered" context. */
  context?: string;
  /** Marked done/handled (kept for reference, sorted below open ones). */
  done?: boolean;
}

export type ServerMsg =
  | { type: 'hello'; channels: ChannelInfo[]; cols: number; rows: number; zen: boolean; templates: Template[]; sparks: Spark[] }
  | { type: 'zen'; on: boolean }
  | { type: 'status'; channel: ChannelInfo }
  | { type: 'searchResults'; query: string; hits: SearchHit[] }
  | { type: 'templates'; templates: Template[] }
  | { type: 'sparks'; sparks: Spark[] }
  | { type: 'order'; orderedIds: string[] }
  | { type: 'replay'; id: string; phase: 'start' | 'end' }
  | { type: 'channelRemoved'; id: string }
  | { type: 'exit'; id: string; exitCode: number };

export type ClientMsg =
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'redraw' }
  | { type: 'acted'; id: string }
  /** Send a prompt into Claude from a wall card (typed + Enter). */
  | { type: 'reply'; id: string; text: string }
  | { type: 'dismiss'; id: string }
  | { type: 'flow'; id: string; action: 'pause' | 'resume' }
  | { type: 'focus'; id: string | null }
  | { type: 'appFocus'; focused: boolean }
  | { type: 'create'; name: string; cwd: string; autostart?: string; shell?: boolean }
  | { type: 'remove'; id: string }
  | { type: 'respawn'; id: string; continueClaude?: boolean }
  | { type: 'rename'; id: string; name: string }
  | { type: 'reorder'; orderedIds: string[] }
  | { type: 'zen'; on: boolean }
  | { type: 'search'; query: string }
  | { type: 'saveTemplate'; name: string }
  | { type: 'launchTemplate'; name: string }
  | { type: 'deleteTemplate'; name: string }
  | { type: 'addSpark'; channelId: string; text: string; context?: string }
  | { type: 'editSpark'; id: string; text: string }
  | { type: 'toggleSpark'; id: string }
  | { type: 'deleteSpark'; id: string };

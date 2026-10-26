import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { ChannelManager } from './channelManager';
import { Channel } from './channel';
import { notifyMac } from './notify';
import { headline } from './handoff';
import { type Config, saveConfig } from './config';
import { searchBuffer } from './search';
import { tmuxCapture } from './tmux';
import { MSG_INPUT, MSG_OUTPUT, type ClientMsg, type ServerMsg, type NeedsReason, type ChannelInfo, type SearchHit, type Handoff } from '../../shared/protocol';

const GLOBAL_BUFFER_LIMIT = 8 * 1024 * 1024;
const REPLAY_CHUNK = 64 * 1024;

export class Transport {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private clientPaused = new Set<string>();
  private globallyPaused = false;
  private drainTimer?: NodeJS.Timeout;
  private activeChannelId: string | null = null;
  private appFocused = true;

  constructor(
    server: Server,
    private manager: ChannelManager,
    private allowedOrigins: Set<string>,
    private config: Config,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      // This socket types into real shells. Only pages we served (or the
      // Tauri shell) may speak to it; anything with a foreign Origin dies here.
      const origin = req.headers.origin;
      if ((origin && !this.allowedOrigins.has(origin)) || req.url !== '/ws') {
        socket.destroy();
        return;
      }
      (socket as Socket).setNoDelay(true); // disable Nagle — send terminal bytes without TCP batching delay
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
  }

  broadcastOutput(ch: Channel, buf: Buffer): void {
    if (!this.clients.size) return;
    const frame = Buffer.concat([Buffer.from([MSG_OUTPUT, ch.idx]), buf]);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
    this.checkGlobalBackpressure();
  }

  broadcastStatus(ch: Channel): void {
    // A closed channel's shell exits a beat after its removal was broadcast;
    // echoing that status would resurrect a dead row in every window.
    if (this.manager.channels.get(ch.id) !== ch) return;
    this.broadcastJson({ type: 'status', channel: ch.info() });
  }

  broadcastExit(ch: Channel, exitCode: number): void {
    if (this.manager.channels.get(ch.id) !== ch) return;
    this.broadcastJson({ type: 'exit', id: ch.id, exitCode });
    this.broadcastStatus(ch);
  }

  handleAttention(ch: Channel, kind: NeedsReason | 'review' | 'error', message?: string): void {
    if (!this.config.notifications || this.config.zen) return; // zen mode = no banners
    // Blocks (permission, bell, Claude stopped mid-turn for you) and crashes
    // banner here.
    if (kind === 'review') return; // finished turns banner via handleHandoff, with their text
    if (kind !== 'error' && this.appFocused && this.activeChannelId === ch.id) return; // already looking at it
    let body: string;
    if (kind === 'error') {
      const code = ch.info().exitCode;
      body = `Exited unexpectedly${code != null ? ` (code ${code})` : ''}`;
    } else {
      body = message ?? (kind === 'permission' ? 'Claude needs permission' : 'Claude needs you');
    }
    notifyMac(`Clack — #${ch.name}`, body);
  }

  /**
   * A finished turn's summary arrived. This is the banner auto mode was missing:
   * with no permission prompts, a finished turn is the only moment a session
   * needs you — so say what it did (or what it's asking) right in the banner.
   */
  handleHandoff(ch: Channel, h: Handoff): void {
    if (!this.config.notifications || this.config.zen) return;
    if (ch.status.state !== 'REVIEW') return; // you were looking at it when it finished
    if (this.appFocused && this.activeChannelId === null) return; // the wall is up; you'll see the card
    notifyMac(`#${ch.name} ${h.kind === 'asks' ? 'asks' : 'is done'}`, headline(h) || 'finished a turn');
  }

  private onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.sendJson(ws, {
      type: 'hello',
      channels: this.channelInfos(),
      cols: this.manager.cols,
      rows: this.manager.rows,
      zen: this.config.zen,
      templates: this.manager.templates,
      sparks: this.manager.sparks,
    });
    for (const ch of this.manager.channels.values()) {
      this.sendJson(ws, { type: 'replay', id: ch.id, phase: 'start' });
      const snap = ch.replaySnapshot();
      for (let off = 0; off < snap.length; off += REPLAY_CHUNK) {
        ws.send(Buffer.concat([Buffer.from([MSG_OUTPUT, ch.idx]), snap.subarray(off, off + REPLAY_CHUNK)]));
      }
      this.sendJson(ws, { type: 'replay', id: ch.id, phase: 'end' });
    }
    // The client drives the post-replay repaint (see the 'redraw' message): it
    // first sends its true geometry, then asks us to wiggle. A blind server-side
    // timer here would race the client's fit and repaint at the wrong size.
    ws.on('message', (data, isBinary) => this.onMessage(ws, data as Buffer, isBinary));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  private onMessage(ws: WebSocket, data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      if (data.length < 2 || data[0] !== MSG_INPUT) return;
      this.manager.byIdx(data[1])?.write(data.subarray(2));
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'resize':
        if (msg.cols >= 20 && msg.cols <= 500 && msg.rows >= 5 && msg.rows <= 200) {
          this.manager.resizeAll(Math.floor(msg.cols), Math.floor(msg.rows));
        }
        break;
      case 'redraw':
        // after a reconnect+replay, force every alt-screen app (Claude TUI, vim)
        // to repaint at the now-correct geometry, overwriting the stale replay
        this.manager.wiggleAll();
        break;
      case 'acted':
        // a real keystroke — tentatively clear this channel's attention state
        this.manager.channels.get(msg.id)?.acted();
        break;
      case 'reply': {
        // Only into a Claude that's sitting at its prompt — typing into a
        // permission dialog or a running turn would pick options / queue input.
        const ch = this.manager.channels.get(msg.id);
        if (!ch || typeof msg.text !== 'string') break;
        const s = ch.status.state;
        if (s === 'REVIEW' || s === 'CLAUDE_IDLE') {
          ch.sendPrompt(msg.text);
        }
        break;
      }
      case 'dismiss':
        // explicit "I've seen it" — downgrade to the resting (gray) state
        this.manager.channels.get(msg.id)?.status.acknowledge();
        break;
      case 'flow': {
        const ch = this.manager.channels.get(msg.id);
        if (!ch) break;
        if (msg.action === 'pause') {
          this.clientPaused.add(msg.id);
          ch.pause();
        } else {
          this.clientPaused.delete(msg.id);
          if (!this.globallyPaused) ch.resume();
        }
        break;
      }
      case 'focus': {
        this.activeChannelId = msg.id;
        if (msg.id) {
          const ch = this.manager.channels.get(msg.id);
          if (ch) {
            this.clientPaused.delete(ch.id);
            if (!this.globallyPaused) ch.resume(); // an active channel is never left frozen
          }
        }
        this.applyFocus();
        break;
      }
      case 'appFocus':
        this.appFocused = msg.focused;
        this.applyFocus();
        break;
      case 'create': {
        if (typeof msg.name !== 'string' || typeof msg.cwd !== 'string' || !msg.name.trim() || !msg.cwd.trim()) break;
        const ch = this.manager.create(msg.name.trim(), msg.cwd.trim(), msg.autostart?.trim() || undefined, msg.shell === true);
        this.broadcastStatus(ch);
        break;
      }
      case 'remove':
        this.manager.remove(msg.id);
        this.clientPaused.delete(msg.id);
        this.broadcastJson({ type: 'channelRemoved', id: msg.id });
        break;
      case 'respawn': {
        const ch = this.manager.respawn(msg.id, msg.continueClaude);
        if (ch) this.broadcastStatus(ch);
        break;
      }
      case 'rename': {
        const ch = this.manager.rename(msg.id, msg.name);
        if (ch) this.broadcastStatus(ch);
        break;
      }
      case 'reorder': {
        this.manager.reorder(msg.orderedIds);
        // broadcast the canonical order so every window (incl. the initiator) agrees
        this.broadcastJson({ type: 'order', orderedIds: this.manager.orderedIds() });
        break;
      }
      case 'zen':
        if (this.config.zen !== msg.on) {
          this.config.zen = msg.on;
          saveConfig(this.config);
        }
        this.broadcastJson({ type: 'zen', on: msg.on }); // sync every window
        break;
      case 'search': {
        const query = (msg.query ?? '').trim();
        const hits: SearchHit[] = [];
        if (query.length >= 2) {
          for (const ch of this.manager.channels.values()) {
            // capture-pane gives clean text lines (works for Claude's alt-screen TUI,
            // where the raw output stream is just cursor-positioning escapes).
            const hit = searchBuffer(tmuxCapture(ch.id), query);
            if (hit) hits.push({ id: ch.id, name: ch.name, count: hit.count, snippets: hit.snippets });
          }
          hits.sort((a, b) => b.count - a.count);
        }
        this.sendJson(ws, { type: 'searchResults', query, hits });
        break;
      }
      case 'saveTemplate':
        if (msg.name?.trim()) {
          this.manager.saveTemplate(msg.name.trim());
          this.broadcastJson({ type: 'templates', templates: this.manager.templates });
        }
        break;
      case 'launchTemplate':
        for (const ch of this.manager.launchTemplate(msg.name)) this.broadcastStatus(ch);
        break;
      case 'deleteTemplate':
        this.manager.deleteTemplate(msg.name);
        this.broadcastJson({ type: 'templates', templates: this.manager.templates });
        break;
      case 'addSpark':
        this.manager.addSpark(msg.channelId, msg.text, msg.context);
        this.broadcastJson({ type: 'sparks', sparks: this.manager.sparks });
        break;
      case 'editSpark':
        this.manager.editSpark(msg.id, msg.text);
        this.broadcastJson({ type: 'sparks', sparks: this.manager.sparks });
        break;
      case 'toggleSpark':
        this.manager.toggleSpark(msg.id);
        this.broadcastJson({ type: 'sparks', sparks: this.manager.sparks });
        break;
      case 'deleteSpark':
        this.manager.deleteSpark(msg.id);
        this.broadcastJson({ type: 'sparks', sparks: this.manager.sparks });
        break;
    }
  }

  /** The engine's notion of "focused" = app focused AND channel active. */
  private applyFocus(): void {
    for (const ch of this.manager.channels.values()) {
      ch.status.focus(this.appFocused && ch.id === this.activeChannelId);
    }
  }

  private checkGlobalBackpressure(): void {
    if (this.globallyPaused) return;
    for (const ws of this.clients) {
      if (ws.bufferedAmount > GLOBAL_BUFFER_LIMIT) {
        this.globallyPaused = true;
        for (const ch of this.manager.channels.values()) ch.pause();
        this.drainTimer = setInterval(() => {
          const worst = Math.max(0, ...[...this.clients].map((c) => c.bufferedAmount));
          if (worst < GLOBAL_BUFFER_LIMIT / 4) {
            clearInterval(this.drainTimer);
            this.drainTimer = undefined;
            this.globallyPaused = false;
            for (const ch of this.manager.channels.values()) {
              if (!this.clientPaused.has(ch.id)) ch.resume();
            }
          }
        }, 250);
        return;
      }
    }
  }

  private channelInfos(): ChannelInfo[] {
    return [...this.manager.channels.values()].map((ch) => ch.info());
  }

  private sendJson(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcastJson(msg: ServerMsg): void {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
    }
  }
}

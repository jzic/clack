import { MSG_INPUT, MSG_OUTPUT, type ClientMsg, type ServerMsg, type ChannelInfo } from '../../shared/protocol';
import { useStore } from './store';

const WS_URL = import.meta.env.DEV ? 'ws://127.0.0.1:8127/ws' : `ws://${location.host}/ws`;

export class ClackSocket {
  onOutput?: (id: string, bytes: Uint8Array) => void;
  onReplay?: (id: string, phase: 'start' | 'end') => void;
  onChannelsKnown?: (channels: ChannelInfo[], cols: number, rows: number) => void;
  onChannelAdded?: (id: string) => void;
  onChannelRemoved?: (id: string) => void;
  /** Fired once the replay burst after a (re)connect has settled. */
  onReplaySettled?: () => void;
  /** Server's authoritative zen state (on hello and on change). */
  onZen?: (on: boolean) => void;

  private ws?: WebSocket;
  private idxToId = new Map<number, string>();
  private idToIdx = new Map<string, number>();
  private retryMs = 500;
  private encoder = new TextEncoder();
  private settleTimer?: ReturnType<typeof setTimeout>;

  connect(): void {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          this.handleJson(JSON.parse(ev.data));
        } catch (err) {
          console.error('clack: bad server message', err);
        }
      } else {
        this.handleBinary(new Uint8Array(ev.data as ArrayBuffer));
      }
    };
    ws.onclose = () => {
      useStore.getState().setConnected(false);
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
    ws.onerror = () => ws.close();
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInput(id: string, data: string): void {
    const idx = this.idToIdx.get(id);
    if (idx === undefined || this.ws?.readyState !== WebSocket.OPEN) return;
    const bytes = this.encoder.encode(data);
    const frame = new Uint8Array(2 + bytes.length);
    frame[0] = MSG_INPUT;
    frame[1] = idx;
    frame.set(bytes, 2);
    this.ws.send(frame);
  }

  private mapChannel(ch: ChannelInfo): void {
    this.idxToId.set(ch.idx, ch.id);
    this.idToIdx.set(ch.id, ch.idx);
  }

  private handleJson(msg: ServerMsg): void {
    const store = useStore.getState();
    switch (msg.type) {
      case 'hello': {
        this.idxToId.clear();
        this.idToIdx.clear();
        for (const ch of msg.channels) this.mapChannel(ch);
        this.onChannelsKnown?.(msg.channels, msg.cols, msg.rows);
        store.hello(msg.channels);
        store.setTemplates(msg.templates ?? []);
        store.setSparks(msg.sparks ?? []);
        this.onZen?.(msg.zen);
        this.send({ type: 'appFocus', focused: document.hasFocus() });
        const { activeId: active, wallOpen } = useStore.getState();
        if (wallOpen) this.send({ type: 'focus', id: null }); // the wall is up: nothing is "being looked at"
        else if (active) this.send({ type: 'focus', id: active });
        break;
      }
      case 'zen':
        this.onZen?.(msg.on);
        break;
      case 'searchResults':
        if (useStore.getState().searchOpen) store.setSearchHits(msg.hits);
        break;
      case 'templates':
        store.setTemplates(msg.templates);
        break;
      case 'sparks':
        store.setSparks(msg.sparks);
        break;
      case 'order':
        store.applyOrder(msg.orderedIds);
        break;
      case 'status': {
        const isNew = !store.channels[msg.channel.id];
        this.mapChannel(msg.channel);
        store.upsert(msg.channel);
        if (isNew) this.onChannelAdded?.(msg.channel.id);
        break;
      }
      case 'replay':
        this.onReplay?.(msg.id, msg.phase);
        if (msg.phase === 'end') {
          // debounce across all channels' replay bursts; fire once it's quiet
          clearTimeout(this.settleTimer);
          this.settleTimer = setTimeout(() => this.onReplaySettled?.(), 150);
        }
        break;
      case 'channelRemoved': {
        const idx = this.idToIdx.get(msg.id);
        if (idx !== undefined) this.idxToId.delete(idx);
        this.idToIdx.delete(msg.id);
        store.remove(msg.id);
        this.onChannelRemoved?.(msg.id);
        break;
      }
      case 'exit':
        break; // a status broadcast follows; nothing to do here
    }
  }

  private handleBinary(bytes: Uint8Array): void {
    if (bytes.length < 2 || bytes[0] !== MSG_OUTPUT) return;
    const id = this.idxToId.get(bytes[1]);
    if (id) this.onOutput?.(id, bytes.subarray(2));
  }
}

export const socket = new ClackSocket();

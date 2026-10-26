import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { Channel, ChannelEvents } from './channel';
import { Config, ChannelConfig, saveConfig, expandHome } from './config';

const MAX_CHANNELS = 256; // channelIdx is one byte on the wire

export class ChannelManager {
  readonly channels = new Map<string, Channel>();
  cols = 120;
  rows = 32;
  private nextIdx = 0;
  private byIdxMap = new Map<number, Channel>();

  constructor(private config: Config, private events: ChannelEvents) {
    for (const cfg of config.channels) this.add(cfg, false);
  }

  create(name: string, cwd: string, autostart?: string, shell?: boolean): Channel {
    const cfg: ChannelConfig = { id: crypto.randomUUID(), name, cwd, autostart, shell };
    const ch = this.add(cfg, true);
    return ch;
  }

  remove(id: string): void {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.kill();
    this.channels.delete(id);
    this.byIdxMap.delete(ch.idx);
    this.config.channels = this.config.channels.filter((c) => c.id !== id);
    saveConfig(this.config);
  }

  rename(id: string, name: string): Channel | undefined {
    const ch = this.channels.get(id);
    if (!ch || !name.trim()) return ch;
    ch.name = name.trim();
    const cfg = this.config.channels.find((c) => c.id === id);
    if (cfg) {
      cfg.name = ch.name;
      saveConfig(this.config);
    }
    return ch;
  }

  respawn(id: string, continueClaude = false): Channel | undefined {
    const ch = this.channels.get(id);
    if (!ch || ch.ptyAlive) return ch;
    ch.resetStatus(); // clear any ERROR before coming back to life
    ch.spawn(this.cols, this.rows, continueClaude ? 'claude --continue' : undefined);
    return ch;
  }

  byIdx(idx: number): Channel | undefined {
    return this.byIdxMap.get(idx);
  }

  resizeAll(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    for (const ch of this.channels.values()) ch.resize(cols, rows);
  }

  wiggleAll(): void {
    for (const ch of this.channels.values()) ch.wiggle(this.cols, this.rows);
  }

  killAll(): void {
    for (const ch of this.channels.values()) ch.kill();
  }

  get templates() {
    return this.config.templates;
  }

  /** Snapshot the current channel set as a named template (replaces same-named). */
  saveTemplate(name: string): void {
    const channels = this.config.channels.map((c) => ({ name: c.name, cwd: c.cwd, autostart: c.autostart, shell: c.shell }));
    this.config.templates = [...this.config.templates.filter((t) => t.name !== name), { name, channels }];
    saveConfig(this.config);
  }

  launchTemplate(name: string): Channel[] {
    const t = this.config.templates.find((t) => t.name === name);
    if (!t) return [];
    return t.channels.map((c) => this.create(c.name, c.cwd, c.autostart, c.shell));
  }

  deleteTemplate(name: string): void {
    this.config.templates = this.config.templates.filter((t) => t.name !== name);
    saveConfig(this.config);
  }

  get sparks() {
    return this.config.sparks;
  }

  /** Capture an idea against a channel. Server stamps id/time; name snapshotted for display. */
  addSpark(channelId: string, text: string, context?: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const channelName = this.channels.get(channelId)?.name ?? 'unknown';
    this.config.sparks.push({
      id: crypto.randomUUID(),
      channelId,
      channelName,
      text: trimmed,
      createdAt: Date.now(),
      context: context?.trim() || undefined,
    });
    saveConfig(this.config);
  }

  editSpark(id: string, text: string): void {
    const s = this.config.sparks.find((s) => s.id === id);
    const trimmed = text.trim();
    if (!s || !trimmed) return;
    s.text = trimmed;
    saveConfig(this.config);
  }

  toggleSpark(id: string): void {
    const s = this.config.sparks.find((s) => s.id === id);
    if (!s) return;
    s.done = !s.done;
    saveConfig(this.config);
  }

  deleteSpark(id: string): void {
    this.config.sparks = this.config.sparks.filter((s) => s.id !== id);
    saveConfig(this.config);
  }

  /**
   * Reorder the sidebar. `idx` (the wire-routing byte) is immutable; only the
   * display `order` changes. Persisted by reordering config.channels to match,
   * so it survives restarts (order is derived from array position on load).
   */
  reorder(orderedIds: string[]): void {
    const pos = new Map(orderedIds.map((id, i) => [id, i]));
    for (const ch of this.channels.values()) {
      const p = pos.get(ch.id);
      if (p !== undefined) ch.order = p;
    }
    this.config.channels.sort(
      (a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    saveConfig(this.config);
  }

  /** Current display order (ids sorted by their `order`) — the canonical answer. */
  orderedIds(): string[] {
    return [...this.channels.values()].sort((a, b) => a.order - b.order).map((c) => c.id);
  }

  private add(cfg: ChannelConfig, persist: boolean): Channel {
    if (this.nextIdx >= MAX_CHANNELS) throw new Error('channel limit reached');
    const cwd = expandHome(cfg.cwd);
    const resolved = fs.existsSync(cwd) ? cwd : os.homedir();
    const ch = new Channel({ ...cfg, cwd: resolved }, this.nextIdx++, this.config.port, this.events);
    ch.order = this.channels.size; // append to the end of the current order
    this.channels.set(ch.id, ch);
    this.byIdxMap.set(ch.idx, ch);
    ch.spawn(this.cols, this.rows);
    if (persist) {
      this.config.channels.push(cfg);
      saveConfig(this.config);
    }
    return ch;
  }
}

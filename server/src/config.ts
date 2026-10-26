import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Template, Spark } from '../../shared/protocol';

export interface ChannelConfig {
  id: string;
  name: string;
  cwd: string;
  autostart?: string;
  shell?: boolean;
}

export interface Config {
  port: number;
  notifications: boolean;
  /** Zen mode: mute macOS banners and cap the attention visuals. Persisted across restarts. */
  zen: boolean;
  scrollback: number;
  channels: ChannelConfig[];
  templates: Template[];
  /** Captured ideas worth revisiting — never leaves this machine, never committed. */
  sparks: Spark[];
}

const CONFIG_DIR = path.join(os.homedir(), '.clack');
// CLACK_CONFIG lets you run an isolated instance against a throwaway config.
const CONFIG_PATH = process.env.CLACK_CONFIG || path.join(CONFIG_DIR, 'config.json');

const DEFAULTS: Config = { port: 8127, notifications: true, zen: false, scrollback: 5000, channels: [], templates: [], sparks: [] };

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const config: Config = {
      ...DEFAULTS,
      ...raw,
      channels: Array.isArray(raw.channels) ? raw.channels : [],
      templates: Array.isArray(raw.templates) ? raw.templates : [],
      sparks: Array.isArray(raw.sparks) ? raw.sparks : [],
    };
    return withEnv(config);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`clack: could not read ${CONFIG_PATH}:`, (err as Error).message);
    }
    return withEnv({ ...DEFAULTS, channels: [] });
  }
}

/** CLACK_PORT wins over the file, so an isolated dev instance never collides with the real one. */
function withEnv(config: Config): Config {
  if (process.env.CLACK_PORT) config.port = Number(process.env.CLACK_PORT);
  return config;
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_PATH); // atomic: a crash mid-write can't corrupt the config
}

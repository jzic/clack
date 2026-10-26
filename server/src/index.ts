import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

// With npm ignore-scripts=true (this machine's config), node-pty's install
// script never runs and its prebuilt spawn-helper ships without the exec bit,
// which makes every pty.spawn die with `posix_spawnp failed`. Self-heal here.
try {
  const helper = fileURLToPath(
    new URL(`../../node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`, import.meta.url),
  );
  if (fs.existsSync(helper)) fs.accessSync(helper, fs.constants.X_OK);
} catch {
  const helper = fileURLToPath(
    new URL(`../../node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`, import.meta.url),
  );
  fs.chmodSync(helper, 0o755);
  console.log('clack: fixed exec bit on node-pty spawn-helper');
}
import { loadConfig } from './config';
import { ChannelManager } from './channelManager';
import { Transport } from './wsTransport';
import { registerHookRoute } from './hookRoute';
import { ensureTmuxConf, tmuxAvailable } from './tmux';

const config = loadConfig();

// Channels are backed by tmux so they survive a server restart. Require it.
if (!tmuxAvailable()) {
  console.error('clack: tmux not found on PATH. Install it (e.g. `brew install tmux`) and restart.');
  process.exit(1);
}
ensureTmuxConf();
const app = express();
const server = http.createServer(app);

// manager is created before transport; events forward through this reference
let transport: Transport | undefined;
const manager = new ChannelManager(config, {
  onOutput: (ch, buf) => transport?.broadcastOutput(ch, buf),
  onStatus: (ch) => transport?.broadcastStatus(ch),
  onAttention: (ch, kind, message) => transport?.handleAttention(ch, kind, message),
  onHandoff: (ch, h) => transport?.handleHandoff(ch, h),
  onExit: (ch, code) => transport?.broadcastExit(ch, code),
});

const allowedOrigins = new Set([
  `http://127.0.0.1:${config.port}`,
  `http://localhost:${config.port}`,
  'http://127.0.0.1:5173', // vite dev server
  'http://localhost:5173',
  'tauri://localhost',
]);
transport = new Transport(server, manager, allowedOrigins, config);

registerHookRoute(app, manager);
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, channels: manager.channels.size });
});

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Clack server on http://127.0.0.1:${config.port} — ${manager.channels.size} channel(s)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    // Do NOT kill the tmux sessions — detaching (which happens as we exit) is
    // what lets the shells/Claude survive a restart. Just let go.
    process.exit(0);
  });
}

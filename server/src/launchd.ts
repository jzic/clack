// Install/uninstall a launchd LaunchAgent so clack-server survives logout,
// crashes, and app restarts (the sessions live in the server, not the UI).
//
//   npm run launchd:install
//   npm run launchd:uninstall
//
// Note: the plist runs `npm start` in this repo. Keep the repo where it is, or
// re-run install after moving it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';

const LABEL = 'com.clack.server';
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function nodeBin(): string {
  return process.execPath;
}

function plist(): string {
  const nodeDir = path.dirname(nodeBin());
  const npmCli = path.join(nodeDir, 'npm');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npmCli}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${repoRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${nodeDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(os.homedir(), '.clack', 'server.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(os.homedir(), '.clack', 'server.err.log')}</string>
</dict>
</plist>
`;
}

function portInUse(port: number): boolean {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false; // lsof exits non-zero when nothing is listening
  }
}

function install(): void {
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.join(os.homedir(), '.clack'), { recursive: true });
  fs.writeFileSync(plistPath, plist());

  const port = loadConfig().port;
  if (portInUse(port)) {
    // A server is already holding the port (and live sessions). Starting a second
    // one now would fight for the port; forcing a handoff would kill those
    // sessions. Install the agent but let it take over at next login instead.
    console.log(`Installed ${LABEL}, but a Clack server is already running on port ${port}.`);
    console.log('Left it alone so live sessions are not disrupted — the agent takes over automatically at your next login.');
    console.log(`To hand off now instead: stop the running server, then run  launchctl load ${plistPath}`);
    console.log('(restarting ends live channels; conversations recover with `claude --continue`).');
    return;
  }

  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    /* not loaded yet */
  }
  execFileSync('launchctl', ['load', plistPath]);
  console.log(`Installed and loaded ${LABEL}. Clack server now starts at login and restarts on crash.`);
}

function uninstall(): void {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    /* fine */
  }
  fs.rmSync(plistPath, { force: true });
  console.log(`Removed ${LABEL}.`);
}

const cmd = process.argv[2];
if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else {
  console.log('usage: tsx src/launchd.ts <install|uninstall>');
  process.exit(1);
}

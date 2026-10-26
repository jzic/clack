import { execFile } from 'node:child_process';

/** macOS banner via osascript — the browser-dev path; the Tauri shell uses native notifications instead. */
export function notifyMac(title: string, body: string): void {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `display notification "${esc(body)}" with title "${esc(title)}" sound name "Glass"`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('clack: notification failed:', err.message);
  });
}

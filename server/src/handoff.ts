import { open } from 'node:fs/promises';
import type { Handoff } from '../../shared/protocol';

const TAIL_BYTES = 512 * 1024; // the final turn always lives in the tail of the transcript
const MAX_TEXT = 6000;

/**
 * Claude's closing words for the turn: the trailing run of assistant text
 * blocks after its last tool call. Returns undefined when the turn's final
 * message isn't in the transcript yet (the walk hits a tool result or the
 * user's prompt first), so a not-yet-flushed transcript never yields the
 * PREVIOUS turn's text.
 */
export function extractFinalText(jsonl: string): string | undefined {
  const lines = jsonl.split('\n');
  const parts: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // first line of the tail is usually cut mid-record
    }
    if (entry.isSidechain) continue; // subagent chatter
    if (entry.type !== 'assistant' && entry.type !== 'user') continue; // titles, modes, attachments
    if (entry.type === 'user') break;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    if (content.some((b: any) => b?.type === 'tool_use')) break;
    const text = content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
    if (text.trim()) parts.unshift(text.trim());
  }
  const out = parts.join('\n\n').trim();
  return out ? out.slice(0, MAX_TEXT) : undefined;
}

/** Does the turn end by asking you something? Judged on its last paragraph. */
export function classify(text: string): Handoff['kind'] {
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
  const last = paras[paras.length - 1] ?? '';
  return /\?\s*(\*\*|_|`)?\s*$/m.test(last) ? 'asks' : 'done';
}

/** The line worth putting in a banner: the question if it asks, else the opening line. */
export function headline(h: Handoff): string {
  const paras = h.text.split(/\n\s*\n/).filter((p) => p.trim());
  const pick = h.kind === 'asks' ? paras[paras.length - 1] : paras[0];
  const flat = (pick ?? '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? flat.slice(0, 177) + '…' : flat;
}

export async function readTail(path: string): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

/**
 * Resolve the handoff for a Stop hook. Prefers text the hook hands us directly;
 * otherwise reads the transcript, retrying briefly because Stop can fire a beat
 * before Claude Code flushes the final message to disk.
 */
export async function resolveHandoff(body: any, now: () => number = Date.now): Promise<Handoff | undefined> {
  let text: string | undefined =
    typeof body?.last_assistant_message === 'string' && body.last_assistant_message.trim()
      ? body.last_assistant_message.trim().slice(0, MAX_TEXT)
      : undefined;
  const path = typeof body?.transcript_path === 'string' ? body.transcript_path : undefined;
  for (const delay of [150, 600, 1500]) {
    if (text || !path) break;
    await new Promise((r) => setTimeout(r, delay));
    try {
      text = extractFinalText(await readTail(path));
    } catch {
      return undefined; // unreadable transcript — the card falls back to the terminal title
    }
  }
  if (!text) return undefined;
  return { text, kind: classify(text), at: now() };
}

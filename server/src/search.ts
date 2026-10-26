// Strip terminal escape sequences and search a channel's scrollback.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export interface BufferHit {
  count: number;
  snippets: string[];
}

/**
 * Search a raw terminal-output buffer for `query` (case-insensitive). Returns a
 * match count and up to `maxSnippets` line-context snippets, or null if no match.
 */
export function searchBuffer(raw: string, query: string, maxSnippets = 3): BufferHit | null {
  const q = query.toLowerCase();
  const lines = stripAnsi(raw).split('\n');
  const snippets: string[] = [];
  let count = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const idx = line.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    count++;
    if (snippets.length < maxSnippets) {
      const start = Math.max(0, idx - 24);
      const end = Math.min(line.length, idx + query.length + 76);
      snippets.push((start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : ''));
    }
  }
  return count ? { count, snippets } : null;
}

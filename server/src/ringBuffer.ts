/**
 * Byte ring buffer that evicts whole chunks, never partial ones, so a replay
 * can only ever start at a chunk boundary (avoids tearing escape sequences
 * mid-stream). A single chunk larger than the cap is kept whole.
 */
export class ChunkRingBuffer {
  private chunks: Buffer[] = [];
  private total = 0;

  constructor(private readonly cap: number = 256 * 1024) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.total += chunk.length;
    while (this.total > this.cap && this.chunks.length > 1) {
      this.total -= this.chunks.shift()!.length;
    }
  }

  snapshot(): Buffer {
    return Buffer.concat(this.chunks);
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }

  get size(): number {
    return this.total;
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkRingBuffer } from '../src/ringBuffer';

test('keeps everything under the cap', () => {
  const ring = new ChunkRingBuffer(100);
  ring.push(Buffer.from('a'.repeat(40)));
  ring.push(Buffer.from('b'.repeat(40)));
  assert.equal(ring.snapshot().toString(), 'a'.repeat(40) + 'b'.repeat(40));
});

test('evicts whole chunks from the head when over cap', () => {
  const ring = new ChunkRingBuffer(100);
  ring.push(Buffer.from('a'.repeat(60)));
  ring.push(Buffer.from('b'.repeat(60))); // 120 > 100: evict the whole 'a' chunk
  assert.equal(ring.snapshot().toString(), 'b'.repeat(60));
  assert.equal(ring.size, 60);
});

test('a single chunk larger than the cap is kept whole', () => {
  const ring = new ChunkRingBuffer(10);
  ring.push(Buffer.from('x'.repeat(50)));
  assert.equal(ring.size, 50);
  ring.push(Buffer.from('y'));
  assert.equal(ring.snapshot().toString(), 'y'); // oversize chunk finally evicted whole
});

test('clear empties the buffer', () => {
  const ring = new ChunkRingBuffer(100);
  ring.push(Buffer.from('abc'));
  ring.clear();
  assert.equal(ring.size, 0);
  assert.equal(ring.snapshot().length, 0);
});

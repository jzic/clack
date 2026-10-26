import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PtySignalParser } from '../src/ptySignals';

function collect() {
  const bells: number[] = [];
  const titles: string[] = [];
  const parser = new PtySignalParser({
    onBell: () => bells.push(1),
    onTitle: (t) => titles.push(t),
  });
  return { parser, bells, titles };
}

test('bare BEL counts as a bell', () => {
  const { parser, bells } = collect();
  parser.feed(Buffer.from('hello\x07world'));
  assert.equal(bells.length, 1);
});

test('OSC 0 title with BEL terminator: title parsed, no bell counted', () => {
  const { parser, bells, titles } = collect();
  parser.feed(Buffer.from('\x1b]0;✳ Working on tests\x07'));
  assert.deepEqual(titles, ['✳ Working on tests']);
  assert.equal(bells.length, 0);
});

test('OSC 2 title with ST (ESC \\) terminator', () => {
  const { parser, titles } = collect();
  parser.feed(Buffer.from('\x1b]2;my title\x1b\\'));
  assert.deepEqual(titles, ['my title']);
});

test('OSC 1 (icon name) is ignored', () => {
  const { parser, titles } = collect();
  parser.feed(Buffer.from('\x1b]1;icon\x07'));
  assert.deepEqual(titles, []);
});

test('sequences split across chunk boundaries still parse', () => {
  const { parser, bells, titles } = collect();
  const bytes = Buffer.from('abc\x1b]0;split ti tle\x07def\x07');
  for (const b of bytes) parser.feed(Buffer.from([b])); // worst case: one byte per chunk
  assert.deepEqual(titles, ['split ti tle']);
  assert.equal(bells.length, 1); // only the trailing bare BEL
});

test('CSI sequences pass through without confusing the parser', () => {
  const { parser, bells, titles } = collect();
  parser.feed(Buffer.from('\x1b[1;31mred\x1b[0m\x07'));
  assert.equal(bells.length, 1);
  assert.deepEqual(titles, []);
});

test('unicode titles decode correctly across split chunks', () => {
  const { parser, titles } = collect();
  const seq = Buffer.from('\x1b]0;émoji 🚀 title\x07');
  parser.feed(seq.subarray(0, 9)); // split mid-multibyte
  parser.feed(seq.subarray(9));
  assert.deepEqual(titles, ['émoji 🚀 title']);
});

test('oversized OSC payload is truncated, not unbounded', () => {
  const { parser, titles } = collect();
  parser.feed(Buffer.from(`\x1b]0;${'x'.repeat(10_000)}\x07`));
  assert.equal(titles.length, 1);
  assert.ok(titles[0].length <= 4096);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFinalText, classify, headline } from '../src/handoff';
import { ChannelStatus } from '../src/statusEngine';

const j = (o: object) => JSON.stringify(o);
const user = (content: unknown) => j({ type: 'user', message: { role: 'user', content } });
const asst = (...content: object[]) => j({ type: 'assistant', message: { role: 'assistant', content } });
const text = (t: string) => ({ type: 'text', text: t });
const tool = { type: 'tool_use', id: 't1', name: 'Bash', input: {} };

test('takes the trailing assistant text after the last tool call', () => {
  const log = [
    user('fix the bug'),
    asst(text('Looking now.')),
    asst(tool),
    user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    asst({ type: 'thinking', thinking: '...' }),
    asst(text('Fixed it; 31/31 tests pass.')),
    asst(text('Push to main or open a PR?')),
    j({ type: 'ai-title', aiTitle: 'Fix bug' }),
    j({ type: 'permission-mode', permissionMode: 'auto' }),
  ].join('\n');
  assert.equal(extractFinalText(log), 'Fixed it; 31/31 tests pass.\n\nPush to main or open a PR?');
});

test('returns nothing while the final message is not flushed yet (never the previous turn)', () => {
  const midTurn = [asst(text('old turn answer')), user('next prompt'), asst(tool), user([{ type: 'tool_result' }])];
  assert.equal(extractFinalText(midTurn.join('\n')), undefined);
  assert.equal(extractFinalText([asst(text('old turn answer')), user('next prompt')].join('\n')), undefined);
});

test('skips subagent sidechain entries and a truncated first line', () => {
  const log = ['{"type":"assist', asst(text('Main answer.')), j({ type: 'assistant', isSidechain: true, message: { content: [text('sub')] } })];
  assert.equal(extractFinalText(log.join('\n')), 'Main answer.');
});

test('classify: a closing question asks; a statement is done', () => {
  assert.equal(classify('Done.\n\nWant me to open a PR?'), 'asks');
  assert.equal(classify('Is X true? Yes.\n\nShipped it.'), 'done');
  assert.equal(classify('Should I push it?**'), 'asks');
});

test('headline picks the question for asks, the opener for done', () => {
  assert.equal(headline({ kind: 'asks', text: 'Did a lot.\n\n**Push** or PR?', at: 0 }), 'Push or PR?');
  assert.equal(headline({ kind: 'done', text: 'Refactored X.\n\nDetails…', at: 0 }), 'Refactored X.');
});

test('a handoff from a superseded turn is dropped; a new prompt clears it', () => {
  const eng = new ChannelStatus({ onChange: () => {}, onAttention: () => {} });
  eng.hook('UserPromptSubmit');
  const turn = eng.turn;
  eng.setHandoff({ text: 'done', kind: 'done', at: 1 }, turn);
  assert.equal(eng.handoff?.text, 'done');
  eng.hook('UserPromptSubmit');
  assert.equal(eng.handoff, undefined);
  eng.setHandoff({ text: 'stale', kind: 'done', at: 2 }, turn);
  assert.equal(eng.handoff, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelStatus, type StatusSnapshot, type Scheduler } from '../src/statusEngine';

interface FakeTimer {
  fn: () => void;
  at: number;
  cleared: boolean;
}

function makeEngine() {
  let t = 1_000_000;
  const timers: FakeTimer[] = [];
  const changes: StatusSnapshot[] = [];
  const attentions: string[] = [];
  const scheduler: Scheduler = {
    set: (fn, ms) => {
      const h: FakeTimer = { fn, at: t + ms, cleared: false };
      timers.push(h);
      return h;
    },
    clear: (h) => {
      if (h) (h as FakeTimer).cleared = true;
    },
  };
  const eng = new ChannelStatus(
    { onChange: (s) => changes.push(s), onAttention: (k) => attentions.push(k) },
    () => t,
    scheduler,
  );
  const advance = (ms: number) => {
    t += ms;
    for (const h of [...timers].sort((a, b) => a.at - b.at)) {
      if (!h.cleared && h.at <= t) {
        h.cleared = true;
        h.fn();
      }
    }
  };
  return { eng, advance, changes, attentions, tick: (ms: number) => (t += ms) };
}

test('hook lifecycle: start -> prompt -> stop(unfocused) -> review -> session end', () => {
  const { eng, attentions, tick } = makeEngine();
  eng.hook('SessionStart');
  assert.equal(eng.state, 'CLAUDE_IDLE');
  eng.hook('UserPromptSubmit');
  assert.equal(eng.state, 'WORKING');
  tick(3000); // a real turn takes time; Stop at t+0 would be out-of-order noise
  eng.hook('Stop');
  assert.equal(eng.state, 'REVIEW');
  assert.ok(eng.waitingSince);
  assert.deepEqual(attentions, ['review']);
  eng.hook('SessionEnd');
  assert.equal(eng.state, 'NO_CLAUDE');
  assert.equal(eng.waitingSince, undefined);
});

test('Notification: permission is a block; the idle reminder is never one', () => {
  const { eng, tick, attentions } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(5000);
  eng.hook('Notification', 'Claude needs your permission to use Bash');
  assert.equal(eng.state, 'NEEDS_INPUT');
  assert.equal(eng.reason, 'permission');
  eng.hook('UserPromptSubmit');
  tick(5000);
  // a turn whose Stop we missed (e.g. monitor-driven): the reminder means "finished", not "blocked"
  eng.hook('Notification', 'Claude is waiting for your input');
  assert.equal(eng.state, 'REVIEW');
  assert.equal(eng.reason, undefined);
  assert.deepEqual(attentions, ['permission', 'review']);
});

test('Stop wins over a Notification that lands within 500ms after it', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(3000);
  eng.hook('Stop');
  assert.equal(eng.state, 'REVIEW');
  tick(100);
  eng.hook('Notification', 'Claude is waiting for your input');
  assert.equal(eng.state, 'REVIEW'); // turn-boundary noise ignored
});

test('stale Stop arriving right after a new prompt is ignored', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(100);
  eng.hook('Stop'); // out-of-order delivery from the previous turn
  assert.equal(eng.state, 'WORKING');
});

test('Stop while focused goes straight to idle with no attention', () => {
  const { eng, attentions, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.focus(true);
  eng.hook('UserPromptSubmit');
  tick(3000);
  eng.hook('Stop');
  assert.equal(eng.state, 'CLAUDE_IDLE');
  assert.deepEqual(attentions, []);
});

test('keystroke clears NEEDS_INPUT and REVIEW to idle (never guesses WORKING)', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(5000);
  eng.hook('Notification', 'permission');
  eng.userInput();
  // typing does NOT claim Claude is working — that would leave the pulse stuck
  // if you type then delete without submitting. Only UserPromptSubmit → WORKING.
  assert.equal(eng.state, 'CLAUDE_IDLE');
  tick(3000);
  eng.hook('Stop');
  assert.equal(eng.state, 'REVIEW');
  eng.userInput();
  assert.equal(eng.state, 'CLAUDE_IDLE');
});

test('type-then-delete in a "ready" channel does not get stuck pulsing', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(5000);
  eng.hook('Notification', 'Claude is waiting for your input'); // missed Stop -> REVIEW
  eng.userInput(); // start typing a reply
  eng.userInput(); // ...then delete it — no submit, so no UserPromptSubmit hook
  assert.equal(eng.state, 'CLAUDE_IDLE'); // idle dot, not the working pulse
});

test('REVIEW clears after focus dwell, not on a quick flip-through', () => {
  const { eng, advance, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(3000);
  eng.hook('Stop');
  assert.equal(eng.state, 'REVIEW');
  eng.focus(true);
  eng.focus(false); // flipped away before the dwell elapsed
  advance(2000);
  assert.equal(eng.state, 'REVIEW');
  eng.focus(true);
  advance(2000);
  assert.equal(eng.state, 'CLAUDE_IDLE');
});

test('bell during WORKING promotes only if no Notification arrives', () => {
  const { eng, advance, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(1000);
  eng.bell();
  advance(2000);
  assert.equal(eng.state, 'NEEDS_INPUT');
  assert.equal(eng.reason, 'bell');
});

test('bell followed by Notification does not double-fire', () => {
  const { eng, advance, attentions, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(1000);
  eng.bell();
  eng.hook('Notification', 'Claude needs your permission to use Bash');
  advance(2000);
  assert.equal(eng.state, 'NEEDS_INPUT');
  assert.equal(eng.reason, 'permission');
  assert.deepEqual(attentions, ['permission']); // bell timer found state != WORKING
});

test('output while unfocused sets unread; focus clears it', () => {
  const { eng } = makeEngine();
  eng.hook('SessionStart');
  eng.output();
  assert.equal(eng.unread, true);
  eng.focus(true);
  assert.equal(eng.unread, false);
});

test('degraded mode: unfocused bell promotes directly without hooks', () => {
  const { eng, attentions } = makeEngine();
  eng.bell();
  assert.equal(eng.state, 'NEEDS_INPUT');
  assert.equal(eng.reason, 'bell');
  assert.deepEqual(attentions, ['bell']);
});

test('degraded mode: focused bell is ignored (zsh completion noise)', () => {
  const { eng } = makeEngine();
  eng.focus(true);
  eng.bell();
  assert.equal(eng.state, 'NO_CLAUDE');
});

test('degraded mode: sustained output infers WORKING, quiescence drops it', () => {
  const { eng, advance, tick } = makeEngine();
  eng.output();
  tick(1000);
  eng.output();
  assert.equal(eng.state, 'NO_CLAUDE'); // only 2 seconds of activity so far
  tick(1000);
  eng.output();
  assert.equal(eng.state, 'WORKING');
  advance(2500); // idle timer fires
  assert.equal(eng.state, 'NO_CLAUDE');
});

test('shell channel never infers WORKING from output', () => {
  const { eng, advance, tick } = makeEngine();
  eng.shell = true;
  eng.output();
  tick(1000);
  eng.output();
  tick(1000);
  eng.output();
  advance(0);
  assert.equal(eng.state, 'NO_CLAUDE'); // scratch terminal stays quiet
});

test('shell channel bell never raises NEEDS_INPUT', () => {
  const { eng } = makeEngine();
  eng.shell = true;
  eng.bell();
  assert.equal(eng.state, 'NO_CLAUDE');
});

test('Notification captures the ask, and it clears once answered', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(3000);
  eng.hook('Notification', 'Claude needs your permission to use Bash(git push)');
  assert.equal(eng.state, 'NEEDS_INPUT');
  assert.equal(eng.attentionMessage, 'Claude needs your permission to use Bash(git push)');
  eng.userInput(); // answered -> the ask is cleared
  assert.equal(eng.attentionMessage, undefined);
});

test('crash -> ERROR with exit code and an attention; reset clears it', () => {
  const { eng, attentions } = makeEngine();
  eng.crashed(137);
  assert.equal(eng.state, 'ERROR');
  assert.equal(eng.exitCode, 137);
  assert.ok(eng.waitingSince);
  assert.deepEqual(attentions, ['error']);
  eng.reset();
  assert.equal(eng.state, 'NO_CLAUDE');
  assert.equal(eng.exitCode, undefined);
});

test('leaving ERROR clears the exit code', () => {
  const { eng } = makeEngine();
  eng.crashed(1);
  eng.hook('SessionStart'); // respawned and Claude came up
  assert.equal(eng.state, 'CLAUDE_IDLE');
  assert.equal(eng.exitCode, undefined);
});

test('title changes emit onChange', () => {
  const { eng, changes } = makeEngine();
  eng.setTitle('✳ fixing the tests');
  assert.equal(changes.at(-1)?.title, '✳ fixing the tests');
  const n = changes.length;
  eng.setTitle('✳ fixing the tests'); // no-op
  assert.equal(changes.length, n);
});

test('acknowledge: REVIEW downgrades to CLAUDE_IDLE (gray) and clears waiting', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(3000);
  eng.hook('Stop'); // unfocused -> REVIEW
  assert.equal(eng.state, 'REVIEW');
  eng.acknowledge();
  assert.equal(eng.state, 'CLAUDE_IDLE');
  assert.equal(eng.waitingSince, undefined);
});

test('acknowledge: a plain "waiting for input" answer downgrades to gray', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(5000);
  eng.hook('Notification', 'Claude is waiting for your input');
  assert.equal(eng.state, 'REVIEW'); // review, then seen -> idle
  eng.acknowledge();
  assert.equal(eng.state, 'CLAUDE_IDLE');
  assert.equal(eng.reason, undefined);
  assert.equal(eng.attentionMessage, undefined);
});

test('acknowledge: ERROR downgrades to NO_CLAUDE and clears the exit code', () => {
  const { eng } = makeEngine();
  eng.crashed(1);
  assert.equal(eng.state, 'ERROR');
  eng.acknowledge();
  assert.equal(eng.state, 'NO_CLAUDE');
  assert.equal(eng.exitCode, undefined);
});

test('acknowledge: clears an unread dot even when idle', () => {
  const { eng, changes } = makeEngine();
  eng.hook('SessionStart'); // CLAUDE_IDLE, focused=false
  eng.output(); // unfocused output -> unread
  assert.equal(eng.unread, true);
  const n = changes.length;
  eng.acknowledge();
  assert.equal(eng.unread, false);
  assert.ok(changes.length > n); // emitted the change
});

test('the ~60s idle reminder after a finished turn does not re-flag it', () => {
  const { eng, tick, attentions } = makeEngine();
  eng.hook('SessionStart');
  eng.hook('UserPromptSubmit');
  tick(3000);
  eng.hook('Stop');
  assert.equal(eng.state, 'REVIEW');
  tick(60_000);
  eng.hook('Notification', 'Claude is waiting for your input');
  assert.equal(eng.state, 'REVIEW'); // still "asks/done", not a new "waiting" state
  eng.acknowledge(); // you marked it seen...
  tick(60_000);
  eng.hook('Notification', 'Claude is waiting for your input');
  assert.equal(eng.state, 'CLAUDE_IDLE'); // ...and it stays seen
  assert.deepEqual(attentions, ['review']);
});

test('a permission prompt still flags even when the turn looks finished', () => {
  const { eng, tick } = makeEngine();
  eng.hook('SessionStart');
  tick(5000);
  eng.hook('Notification', 'Claude needs your permission to use Bash');
  assert.equal(eng.state, 'NEEDS_INPUT');
  assert.equal(eng.reason, 'permission');
});

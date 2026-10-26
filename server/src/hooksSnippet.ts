// Prints the hook entries to merge into ~/.claude/settings.json.
// MERGE these into any existing "hooks" object — do not replace entries you
// already have. The guard makes non-Clack sessions no-op in ~1ms, and the
// trailing `exit 0` + curl timeout guarantee a hook can never block Claude.

const CMD =
  '[ -n "$CLACK_CHANNEL_ID" ] && curl -s -m 1 -X POST "http://127.0.0.1:${CLACK_PORT:-8127}/api/hook?channel=$CLACK_CHANNEL_ID" -H \'Content-Type: application/json\' --data-binary @- >/dev/null 2>&1; exit 0';

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];

const hooks = Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command: CMD }] }]]));

console.log(JSON.stringify({ hooks }, null, 2));

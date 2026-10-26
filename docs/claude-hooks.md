# Wiring Clack into Claude Code (one-time, ~1 minute)

Clack's status engine gets its authoritative signals from Claude Code hooks.
Without them Clack still works in degraded mode (bells + output activity), but
with them you get precise "needs permission / waiting for input / turn
finished" badges — real-time provenance for every channel.

## The easy way (recommended)

```bash
npm run hooks:install      # safe MERGE into ~/.claude/settings.json (+ backup)
npm run hooks:uninstall    # cleanly reverse it
```

The installer preserves every hook you already have, is idempotent, and writes a
backup to `~/.claude/settings.json.clack-backup`. Restart any Claude session
already running in a channel to pick up the hooks. The rest of this file is the
manual equivalent, if you'd rather edit the JSON yourself.

---


## What to add

Run `npm run print-hooks` in the clack repo to print the snippet, or copy from
here. Merge into `~/.claude/settings.json` — **append** to any hook arrays you
already have (e.g. an existing `UserPromptSubmit` hook stays
first; add the Clack entry as a second element of that same array).

The command for every event is identical:

```
[ -n "$CLACK_CHANNEL_ID" ] && curl -s -m 1 -X POST "http://127.0.0.1:${CLACK_PORT:-8127}/api/hook?channel=$CLACK_CHANNEL_ID" -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1; exit 0
```

Add it under these five events: `SessionStart`, `UserPromptSubmit`,
`Notification`, `Stop`, `SessionEnd`, each shaped like:

```json
{ "hooks": [ { "type": "command", "command": "<the command above>" } ] }
```

## Why it's safe

- `[ -n "$CLACK_CHANNEL_ID" ]` — sessions not spawned by Clack skip the curl
  entirely (~1ms, exit 0). Your normal terminal sessions are untouched.
- `-m 1` + `; exit 0` — even if the Clack server is down, the hook can never
  block or fail a Claude session.
- The endpoint only accepts requests without a browser Origin header and only
  updates status badges; it cannot execute anything.

A backup of your settings from before Clack existed is at
`~/.claude/settings.json.clack-backup`.

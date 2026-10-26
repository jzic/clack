import express, { type Express } from 'express';
import { ChannelManager } from './channelManager';
import type { HookEventName } from './statusEngine';
import { resolveHandoff } from './handoff';

const HOOK_EVENTS: ReadonlySet<string> = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SessionEnd',
] satisfies HookEventName[]);

export function registerHookRoute(app: Express, manager: ChannelManager): void {
  app.post('/api/hook', express.json({ limit: '256kb' }), (req, res) => {
    // Hooks arrive via curl and carry no Origin header. A browser page must
    // never be able to poke this endpoint.
    if (req.headers.origin) {
      res.sendStatus(403);
      return;
    }
    res.sendStatus(204); // reply immediately; never make Claude's hook wait
    const channel = manager.channels.get(String(req.query.channel ?? ''));
    if (!channel) return; // hook from a session Clack doesn't own — ignore
    const event = req.body?.hook_event_name;
    if (typeof event !== 'string' || !HOOK_EVENTS.has(event)) return;
    const message = typeof req.body?.message === 'string' ? req.body.message : undefined;
    channel.status.hook(event as HookEventName, message);
    if (event === 'Stop') {
      // Capture the turn's closing words for the wall. Tagged with the turn it
      // belongs to, so a prompt sent while we read the transcript wins.
      const turn = channel.status.turn;
      void resolveHandoff(req.body).then((h) => {
        if (h) channel.status.setHandoff(h, turn);
      });
    }
  });
}

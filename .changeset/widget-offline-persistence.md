---
'@pinagent/vite-plugin': patch
'@pinagent/next-plugin': patch
---

widget: offline-first persistence for the embedded widget.

- Persist the client-side follow-up queue to a per-conversation `localStorage`
  outbox so queued (but unsent) follow-ups survive a page reload instead of
  evaporating; they restore as queued bubbles and flush normally at the next
  turn-end, and are cleared on dismiss / terminal resolve.
- Surface the browser cache's `:memory:` (non-persistent) fallback — the
  SQLite worker now reports its backend in the `init` ACK, and the widget
  shows a quiet, dismissible signal (a FAB dot + title hint and a one-time
  composer-footer note) when persistence is off, typically because another
  tab holds the OPFS storage lock. Backward-compatible: a missing `backend`
  field is treated as persistent.

Both ship inside the embedded widget IIFE / served worker source, so the
vite-plugin and next-plugin embeds are regenerated.

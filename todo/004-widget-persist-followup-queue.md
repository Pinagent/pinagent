# 004 — widget: persist the follow-up queue across page reload

- **Priority:** P2
- **Packages:** `@pinagent/widget` (`packages/widget`)
- **Zone:** Apache-2.0
- **Changeset:** widget itself is changeset-ignored, **but** this changes the embedded IIFE →
  add changesets bumping BOTH `@pinagent/vite-plugin` and `@pinagent/next-plugin` (patch) and
  re-run `pnpm generate:plugin-widget-embed` (`pnpm lint:widget-cascade` enforces)
- **Read `/todo/README.md` ground rules first**

## Context

Follow-ups typed while an agent turn is in flight are queued client-side and flushed
one-per-turn-end, FIFO (`packages/widget/src/stream-handler.ts:321-430`). The queue lives on
the in-memory `composer` object — the comment at `stream-handler.ts:324-325` notes it
deliberately survives **reconnects**, but nothing persists it across a **page reload**: the
parallel `queuedNodes` array (`stream-handler.ts:328`) and queue contents evaporate when the
page unloads. Everything else about a conversation survives reload via the OPFS mirror
(`packages/widget/src/db/client.ts`); queued-but-unsent user messages are the one thing
silently lost.

## Expected behavior

Reload a page with queued (dimmed, "queued"-tagged) follow-ups → the conversation restores
with the same follow-ups still queued, and they flush normally at the next turn-end.
Sent/flushed follow-ups never re-send.

## Implementation notes

**Recommended store: `localStorage` outbox, NOT the SQLite mirror.** Rationale: the mirror is
documented as a *rebuildable* projection of server state (CLAUDE.md invariant; wipe+rehydrate
on divergence) — queued follow-ups are client-originated unsent data, the one thing the
server can't rebuild, so they don't belong in it. Also avoids a `@pinagent/db` schema
migration that the server table set would inherit (browser and server share migrations).

1. Key: e.g. `pinagent:followups:<feedbackId>` → JSON array of `{ text, pickedLoc? }`
   matching what `flushQueue` sends (`stream-handler.ts:316-330` region; note queued entries
   can carry a picked element pill — persist the anchor payload, not the DOM node).
2. Write-through: persist on enqueue, rewrite on flush/promote (the "queued bubble promoted
   to pending" path, `stream-handler.ts:389`), clear key on conversation
   dismiss/delete (`deleteConversation` call sites) and on terminal resolve.
3. Restore: when a conversation is restored from the mirror (the same path that passes
   `replayed` messages into the stream handler, `stream-handler.ts:34-40`), read the key,
   re-render queued bubbles via the existing renderer (`stream-handler.ts:377-381`), and
   resume normal flush behavior.
4. Edge: the "turn in progress" re-queue race (`stream-handler.ts:330`) must not duplicate
   the persisted entry.
5. localStorage is per-origin and the widget is localhost-only — no cross-app leakage
   concern beyond multiple apps on the same port; keying by feedbackId (nanoid) makes
   collisions harmless.

## Acceptance criteria

- [ ] Queue two follow-ups mid-turn, reload the page: both reappear as queued bubbles (in
      order, element pill preserved) and flush one-per-turn-end.
- [ ] After a follow-up is sent, reload: it does not re-queue or re-send.
- [ ] Dismissing a conversation clears its persisted queue.
- [ ] Widget embed regenerated; changesets for vite-plugin + next-plugin present;
      `pnpm lint:widget-cascade` passes.

## Test plan

`packages/widget/tests/` with `// @vitest-environment happy-dom` (localStorage available).
Follow the existing stream-handler test patterns (`agent-tray.test.ts`, helpers in
`tests/_helpers`): drive the handler with a fake WS client, assert persistence round-trip,
flush-once semantics, and clear-on-dismiss. Extend, don't fork, existing helpers.

## Out of scope

- Persisting the *initial* feedback composer draft (pre-submit) — different surface, open a
  follow-up ticket if wanted.
- An outbox for failed `POST /__pinagent/feedback` (noted in the audit as a separate
  weakness).

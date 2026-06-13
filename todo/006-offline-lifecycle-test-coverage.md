# 006 — widget: offline lifecycle test coverage (reconnect / replay / queue)

- **Priority:** P2
- **Packages:** `@pinagent/widget` (tests only)
- **Zone:** Apache-2.0
- **Changeset:** not required (tests don't change shipped bytes; no embed regen needed)
- **Read `/todo/README.md` ground rules first**

## Context

The offline-first layer's *storage* is well tested (`packages/widget/tests/db.test.ts`,
`migrations.test.ts` — writes, idempotency, multi-pick extras, migration backfill). The
*lifecycle* that makes it offline-first is not. Untested today:

1. **Reconnect wipe-then-replay ordering.** On WS reconnect, `onReset` fires per subscription
   *before* re-subscribe (`packages/widget/src/ws-client.ts:127-146`,
   `hasConnectedBefore` gate at :128), and the stream handler serializes the
   `deleteConversationMessages` wipe ahead of replay re-inserts via `dbWriteChain`
   (`packages/widget/src/stream-handler.ts:79-93`, delete in
   `packages/widget/src/db/writes.ts:172-174`). The invariant — exactly one copy of every
   event after reconnect — is enforced only by code comments.
2. **Replayed events don't re-insert.** Constructor-passed `replayed` messages render but
   skip DB writes (`stream-handler.ts:34-40`). A regression here double-writes every
   transcript on restore.
3. **Follow-up queue semantics.** FIFO flush one-per-turn-end, ask-form answer draining the
   queue (`stream-handler.ts:316-317`), and the "send raced an in-flight turn → re-queue,
   don't drop" path (`stream-handler.ts:330`).
4. **Outbound WS queue.** Messages sent while the socket is down are queued and drained on
   reconnect (`ws-client.ts:101-108,143-146`); explicit close must not reconnect
   (`ws-client.ts:160`).

## Expected behavior

Deterministic vitest coverage of 1–4 so refactors of the stream handler / WS client can't
silently break offline recovery. No production code changes — if a seam is missing, add the
smallest possible injection point (e.g. accept a WebSocket factory) rather than restructuring.

## Implementation notes

- `packages/widget/tests/` with `// @vitest-environment happy-dom`; reuse `tests/_helpers`
  (in-memory better-sqlite3 DB — a *test-only* dependency, kept externalized in
  `vitest.config.ts`; don't move it).
- For the WS client, a scriptable fake `WebSocket` (constructor-injectable or
  globalThis-stubbed) that you can open/close/message on demand drives reconnect
  deterministically — avoid real timers where possible (vi.useFakeTimers for the backoff).
- Ordering assertions for (1): spy the write-layer calls (`deleteConversationMessages`,
  `recordEvent`) and assert relative order under an interleaved reconnect+replay; then
  assert final DB row count equals replayed-event count exactly.
- Keep each scenario its own test file or describe-block; name for the invariant, not the
  mechanism (e.g. `reconnect-replays-exactly-once.test.ts`).

## Acceptance criteria

- [ ] A test fails if `onReset` stops firing before re-subscribe on reconnect.
- [ ] A test fails if replayed messages start re-inserting into the mirror (row-count
      assertion), or if the wipe lands after the first replay insert.
- [ ] Tests cover: FIFO one-per-turn-end flush, ask-answer drains the queue, in-flight race
      re-queues (no drop, no duplicate), outbound queue drains on reconnect, explicit close
      never reconnects.
- [ ] `pnpm test` green from a fresh worktree (after full `pnpm build` — tests resolve
      `@pinagent/*` from dist).

## Out of scope

- Browser-real OPFS/worker tests (covered by ticket [005](005-widget-surface-persistence-degradation.md)'s protocol-seam tests).
- agent-runner bus replay tests (server side already exercised via storage/middleware tests;
  open separately if a gap shows up there).

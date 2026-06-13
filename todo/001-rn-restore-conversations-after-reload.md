# 001 — RN: restore conversations after app reload

- **Priority:** P1 (biggest offline-first parity gap)
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0 — SPDX header on line 1 of new files
- **Changeset:** not required (`@pinagent/react-native` is in `.changeset/config.json` ignore)
- **Related:** do together with [002](002-rn-failed-submit-draft-retention.md) (same files); read `/todo/README.md` ground rules first

## Context

On web, the widget mirrors `conversations` + `widget_anchors` + `messages` into an
OPFS-backed SQLite-WASM DB (`packages/widget/src/db/client.ts`), so a page reload mid-run
restores minimized bubbles (`listPendingForCurrentPage`, `packages/widget/src/db/reads.ts:27`)
and full transcripts. The WS protocol guarantees a full transcript replay on every subscribe:
the SQLite-backed bus replays all `messages` rows for a feedback id
(`packages/agent-runner/src/bus.ts:84-141`), and the RN WS client already handles
reconnect-replay (`packages/react-native/src/native/ws-client.ts:14,29,108-112` — `onReset`
"clear and rebuild").

On React Native there is **no persistence at all**: stream state lives in `useState`
(`packages/react-native/src/native/StreamSheet.tsx`, `streams`/`expandedId` in
`packages/react-native/src/native/Pinagent.tsx:399-417`). A Fast Refresh, shake-reload, or
app restart mid-conversation loses every running stream pill and transcript, even though the
dev server still has everything in `.pinagent/db.sqlite`.

## Expected behavior

After an app reload while agent runs are pending, `<Pinagent />` restores a minimized pill
for each still-relevant conversation (same screen, status `pending`), and tapping a pill
opens the stream sheet with the full transcript replayed from the server. No data loss as
long as the dev server is up.

## Implementation notes

**Rehydrate from the server — do not add a device-local store.** The server mirror is the
source of truth and is always reachable when the tool is usable at all (dev-server-attached
by definition). This needs zero new native dependencies.

1. On `<Pinagent />` mount, fetch `GET /__pinagent/feedback` via the existing transport
   (`packages/react-native/src/server/metro-middleware.ts:111-114` already serves the list;
   `packages/react-native/src/native/transport.ts` has the base-URL helper).
2. Filter to conversations worth restoring: `status === 'pending'` AND `url` matching this
   surface — RN submits `url: screenName ?? Platform.OS` (`Pinagent.tsx:224`), mirror that
   filter (web filters per-page the same way, `reads.ts:27-36`). Consider a sanity cap
   (e.g. most recent 5 by `updatedAt`) so a stale backlog doesn't flood the UI.
3. Seed `streams` state with `{ id, target }` pills (target from the conversation's
   anchor/comment fields in the list projection) — **minimized**, not expanded.
4. Subscribing each restored id over the existing WS client replays the transcript; the
   `done` sentinel arrives for already-finished runs, landing the sheet in its normal
   done/dismiss state (web's equivalent: `packages/widget/src/stream-handler.ts:915`).
5. Guard: skip rehydrate entirely when the dev server is unreachable
   (`devServerBaseUrl()` null) — degrade silently as today.

## Acceptance criteria

- [ ] Reloading the example Expo app (`examples/expo-app`) while an inline agent run is
      streaming brings the pill back; expanding it shows the full transcript so far, and the
      stream continues live if the run is still going.
- [ ] Already-finished pending conversations restore showing their final state (replay +
      `done`), resolved/dismissed ones do not restore.
- [ ] Conversations submitted from a different `screenName` do not restore on this screen.
- [ ] No new native dependencies; no behavior change when the dev server is down.

## Test plan

RN runtime code can't be unit-tested in this repo (RN not installed) — test the pure parts:
extract the restore-filter (list → pills) into a pure function in `src/native/` and unit-test
it in `packages/react-native/tests/` (pattern: `transcript.test.ts`). Metro middleware list
endpoint is already covered by `metro-middleware.test.ts`. Manual verify against
`examples/expo-app` is the integration check.

## Out of scope

- Device-local persistence (expo-sqlite/AsyncStorage mirror) for surviving a *dev-server*
  outage — deliberately skipped: native-dep cost is high and a dead dev server means no agent
  anyway. Revisit only if users ask.
- Draft/outbox handling for failed submits — that's [002](002-rn-failed-submit-draft-retention.md).

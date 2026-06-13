# 014 — docs: the offline-first host-integration contract

- **Priority:** P3 (prevents drift as integrations multiply)
- **Packages:** `docs/` (new `docs/architecture/offline-first.md`)
- **Zone:** Apache-2.0 (docs; no SPDX needed in markdown)
- **Changeset:** not required
- **Read `/todo/README.md` ground rules first**

## Context

The offline-first layer's contract — what a host integration must serve, what the browser
mirror stores, and what the recovery semantics are — exists only as code and scattered
README fragments (`packages/widget/README.md` "Local cache", comments in
`packages/widget/src/db/client.ts:7-40`). The repo now has six integrations; the 2026-06
audit (this `/todo` set) found each new one re-derives the contract and drops pieces (RN
shipped with none of it — tickets 001/002). `docs/architecture/` is the established home
for this kind of spec (`docs/architecture/react-native.md`).

## Expected behavior

`docs/architecture/offline-first.md`: a single page an integration author (human or agent)
can implement against without reading the widget source, and that reviewers can cite when a
new integration skips a piece.

## Implementation notes

Write from the code, not from memory — verify every claim. Sections:

1. **Model.** Server SQLite is the source of truth; the browser store is a *rebuildable
   mirror* (never manually reconciled). Mirrored tables: `conversations`, `widget_anchors`,
   `messages` only (`packages/db/src/schema.ts`); `active_runs`/`pull_requests`/
   `audit_events` are server-only. Client-originated *unsent* data (queued follow-ups) is
   explicitly NOT mirror data — see ticket [004](004-widget-persist-followup-queue.md)'s
   rationale; encode that rule here.
2. **Storage.** SQLite-WASM worker, OPFS SAH Pool VFS (`name: 'pinagent'`,
   `pinagent.sqlite`), no COOP/COEP requirement, silent `:memory:` fallback + its triggers
   (`packages/browser-runtime/src/db-worker-source.ts:86-95`); migrations fetched from the
   host and applied with drizzle-compatible tracking, including the pre-tracking backfill
   (`packages/widget/src/db/migrations.ts`).
3. **Host contract.** The exact asset/endpoint surface an integration must serve:
   `/__pinagent/widget.js` (IIFE + `__pinagentConfig` prelude), `/__pinagent/db-worker.js`,
   `/__pinagent/db-migrations`, `/__pinagent/sqlite-wasm/*` (whitelist; note the 3.50 pin —
   3.53 moved `jswasm/` → `dist/`), feedback REST endpoints, and the WS endpoint + message
   types (`subscribe`, `user_message`, `ask_response`, `interrupt`, … → `event`, `done`,
   `error`, `worktree_state`, `project_event`). Cross-check vite middleware
   (`packages/vite-plugin/src/middleware.ts`) and next route
   (`packages/next-plugin/src/route.ts`) and note which endpoints are dock-only vs
   widget-required vs offline-mirror-required.
4. **Recovery semantics.** Subscribe always replays the full transcript (SQLite-backed bus,
   `packages/agent-runner/src/bus.ts:84-141`); on WS reconnect the client wipes the
   conversation's mirrored messages *before* re-subscribing (`ws-client.ts` `onReset` →
   `deleteConversationMessages`, serialized via the stream handler's `dbWriteChain`) so
   replay lands exactly once. Include the offline behavior truth-table from the audit:
   what works with the server down (cached transcript reads, UI), what's lost (failed
   feedback POSTs — no outbox), what recovers on reconnect.
5. **Per-integration status table.** web (vite/next/nuxt) = full; RN = server-rehydrate
   model (tickets 001/002), intentionally no device-local store; dock = no offline layer by
   design (HTTP/WS straight to the host server).
6. **Non-goals.** Multi-tab SAH coordination, cross-device sync, prod usage.

Link the page from `docs/` index/README if one exists, and from
`packages/widget/README.md`'s Local cache section.

## Acceptance criteria

- [ ] `docs/architecture/offline-first.md` covers sections 1–6 with file-path references
      (paths, not line numbers — lines rot).
- [ ] Every endpoint in the host-contract section exists in both vite middleware and next
      route (verified, not copied from this ticket).
- [ ] Widget README links to it; no code changes.

## Out of scope

- Changing any behavior the doc describes (file follow-up tickets instead — the doc records
  what IS, including warts like the missing POST outbox).

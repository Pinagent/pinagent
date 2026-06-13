# The offline-first host-integration contract

Pinagent keeps a small browser-side mirror of its server state so the widget's
conversation transcripts survive a page reload, an HMR cycle, and a transient
dev-server restart. This page is the single contract for that layer: what a host
integration must serve, what the browser mirrors (and what it deliberately does
not), and the recovery semantics that keep the two in sync.

It is written to be implementable without reading the widget source, and citable
in review when a new integration drops a piece. Every claim here was verified
against the code; references are **file paths, not line numbers** (lines rot).

Authoritative sources, if you need to go deeper:

- `packages/db/src/schema.ts` — the shared schema (mirror vs server-only tables)
- `packages/browser-runtime/src/db-worker-source.ts` — the SQLite-WASM worker
- `packages/widget/src/db/client.ts`, `.../db/migrations.ts`, `.../db/writes.ts` — the browser cache
- `packages/vite-plugin/src/middleware.ts`, `packages/next-plugin/src/route.ts` — the host endpoint surface
- `packages/agent-runner/src/bus.ts`, `.../ws-server.ts` — the SQLite-backed event bus + WS server
- `packages/widget/src/ws-client.ts`, `.../stream-handler.ts` — reconnect + replay handling
- `packages/shared/src/ws-protocol.ts` — the WebSocket wire format

---

## 1. Model

**Server SQLite (`.pinagent/db.sqlite`, via `node:sqlite`) is the source of
truth.** The browser store is a *rebuildable mirror* — it is never manually
reconciled, and if it ever diverges it is rebuilt from server state (the schema
header in `packages/db/src/schema.ts` says exactly this).

The mirror holds **only three tables**, and only the rows the current page cares
about:

| Table | Mirrored? | Why |
|---|---|---|
| `conversations` | **yes** | the widget needs comment/status/worktree state offline |
| `widget_anchors` | **yes** | re-anchor the pin across reload/HMR |
| `messages` | **yes** | the transcript — this table *is* the event-stream source of truth |
| `active_runs` | no — server-only | which runs are in flight; the browser only needs the event stream |
| `pull_requests` | no — server-only | dock compose-flow bookkeeping |
| `audit_events` | no — server-only | History/Activity feed |

What the browser actually writes is exactly these three tables — see
`packages/widget/src/db/writes.ts` (it imports only `conversations`,
`widgetAnchors`, `messages`).

**Unsent client-originated data is NOT mirror data.** The widget's follow-up
queue (messages the user typed but that haven't been sent to the server yet)
lives in memory only — it is intentionally *not* written to the browser SQLite
store. The rule: the mirror reflects server-acknowledged state; anything the
server hasn't seen yet is the live UI's responsibility, not the cache's. (On a
WS reconnect the `onReset` handler in `packages/widget/src/stream-handler.ts`
wipes the mirrored `messages` but deliberately keeps `composer.followUpQueue` so
those unsent messages still get a chance to send.) Persisting that queue across a
*reload* is a separate, open piece of work — see ticket
[`004`](../../todo/004-widget-persist-followup-queue.md) for the rationale this
encodes.

---

## 2. Storage

The mirror runs entirely in a Worker so it can use synchronous file I/O:

- **SQLite-WASM worker.** `packages/browser-runtime/src/db-worker-source.ts`
  exports `DB_WORKER_SOURCE`, a self-contained ES-module worker served verbatim
  at `/__pinagent/db-worker.js`. The widget spawns it with
  `new Worker(url, { type: 'module' })` (see `packages/widget/src/db/client.ts`).
  The worker speaks a minimal `{ id, type: 'init' | 'exec', args }` →
  `{ id, ok, rows? }` RPC; the widget wraps it in drizzle's `sqlite-proxy`
  adapter so `db.select().from(conversations)` works the same as on the server.

- **OPFS SAH Pool VFS.** The worker installs the **OPFS SAH Pool VFS**
  (`installOpfsSAHPoolVfs({ name: 'pinagent', initialCapacity: 4 })`), opening
  `pinagent.sqlite` as an `OpfsSAHPoolDb`. This VFS uses
  `FileSystemSyncAccessHandle` (Worker-only) and — unlike the basic `opfs` VFS —
  **does not require cross-origin isolation (COOP/COEP)**. That matters: Next
  dev doesn't set those headers by default, and the basic VFS would log
  "no such vfs: opfs". Persistence survives reload.

- **Silent `:memory:` fallback.** If the SAH Pool install fails (very old
  browsers; or another tab/stale worker already holds the OPFS access handle,
  `NoModificationAllowedError`), the worker catches it and opens
  `new sqlite3.oo1.DB(':memory:')` instead, logging a single
  `backend: :memory: (no persistence)` line. The cache stays functional, just
  non-persistent — the UI never breaks, it just loses its mirror on reload.
  (The fallback's degradation is not yet surfaced to the user — see ticket
  [`005`](../../todo/005-widget-surface-persistence-degradation.md).)

- **Migrations.** The browser does **not** bundle the schema DDL — it fetches it
  from the host at `/__pinagent/db-migrations` (drizzle journal + per-entry SQL +
  sha256 hashes) and applies it with `applyMigrations`
  (`packages/widget/src/db/migrations.ts`). Tracking is **byte-compatible with
  drizzle's server-side `migrate()`**: a `__drizzle_migrations(id, hash,
  created_at)` table, "already applied" decided by comparing the highest
  `created_at` against each entry's `when`. There is a **pre-tracking backfill**:
  an OPFS DB created before tracking existed has the schema but no tracking
  table, so the runner probes for the `conversations` table and, if present,
  inserts every known migration as already-done (same hash/`when` a fresh
  `migrate()` would have written) rather than re-running DDL that would fail on
  `duplicate column name`.

---

## 3. Host contract — the asset/endpoint surface

A host integration must serve the surface below. The first four assets and the
WS endpoint are what make the **offline mirror + live stream** work; the feedback
REST endpoints are the **widget core**; the remaining routes are **dock-only**.

Every endpoint in the *widget-required* and *offline-mirror-required* groups was
cross-checked to exist in **both** `packages/vite-plugin/src/middleware.ts` and
`packages/next-plugin/src/route.ts`. (Next exposes them under
`app/pinagent/[[...slug]]/route.ts`; the `/__pinagent` prefix is the route mount
point.)

### Offline-mirror-required (assets)

These exist only to bootstrap the browser SQLite mirror. An integration that
wants reload-survival must serve all four.

| Method · Path | Serves | In vite | In next |
|---|---|---|---|
| `GET /__pinagent/widget.js` | the widget IIFE, prefixed with a `;(function(){window.__pinagentConfig=…})()` prelude that hands it the WS URL + dock flag | ✅ | ✅ |
| `GET /__pinagent/db-worker.js` | `DB_WORKER_SOURCE` verbatim (the SQLite-WASM worker) | ✅ | ✅ |
| `GET /__pinagent/db-migrations` | drizzle journal + per-entry SQL + sha256, as `{ migrations: [...] }` | ✅ | ✅ |
| `GET /__pinagent/sqlite-wasm/<file>` | proxied SQLite-WASM runtime files, from a fixed **whitelist** (path-traversal-safe) | ✅ | ✅ |

The `sqlite-wasm/<file>` whitelist is identical in both: `sqlite3-bundler-friendly.mjs`,
`sqlite3-worker1-bundler-friendly.mjs`, `sqlite3-opfs-async-proxy.js`,
`sqlite3.mjs`, `sqlite3.js`, `sqlite3.wasm`. Both resolve them out of
`@sqlite.org/sqlite-wasm/.../sqlite-wasm/jswasm`.

> **The 3.50 pin is load-bearing.** `@sqlite.org/sqlite-wasm` is pinned at
> `3.50.0-build1` in vite-plugin, next-plugin, **and** widget. 3.53 moved the
> jswasm files from `jswasm/` to `dist/` and renamed the worker, which breaks
> the `sqlite-wasm/jswasm` path resolution above. Bumping it requires migrating
> the path resolution and a widget-cascade changeset; don't bump it casually.

### Widget-required (feedback REST)

The minimum surface for the click→comment→agent loop, independent of the offline
mirror. Both files implement all of these.

| Method · Path | Does | In vite | In next |
|---|---|---|---|
| `POST /__pinagent/feedback` | create a feedback record (zod-validated, ≤5 MB screenshot), optionally spawn the agent; returns `{ id, agentSpawned }` | ✅ | ✅ |
| `GET /__pinagent/feedback` | shallow conversation list (projection kept in sync with the dock's zod schema) | ✅ | ✅ |
| `GET /__pinagent/feedback/:id` | one record + base64 screenshot | ✅ | ✅ |
| `GET /__pinagent/feedback/:id/messages` | full persisted transcript (`Storage.listMessages`) — lets a client read history without a WebSocket | ✅ | ✅ |
| `PATCH /__pinagent/feedback/:id` | partial update (rename / archive); emits audit events | ✅ | ✅ |
| `POST /__pinagent/open` | open the developer's editor at `file:line:col` | ✅ | ✅ |

### Widget-required (WebSocket)

| Endpoint | Does |
|---|---|
| `WS /__pinagent/ws` | the live agent stream + follow-up channel |

The WS server is **not** part of the HTTP middleware — it's started by
`startWsServer()` in agent-runner (`packages/agent-runner/src/ws-server.ts`,
`WS_PATH = '/__pinagent/ws'`), kicked off from the plugin entry
(`packages/vite-plugin/src/index.ts`) or the route module
(`packages/next-plugin/src/route.ts`), and the `/__pinagent/widget.js` prelude
hands the widget the bound `ws://127.0.0.1:<port>/__pinagent/ws` URL. Wire format
lives in `packages/shared/src/ws-protocol.ts`:

- **client → server:** `subscribe`, `unsubscribe`, `user_message`,
  `ask_response`, `interrupt`, `land_request`, `discard_request`,
  `reopen_request`, `subscribe_project`, `unsubscribe_project`,
  `extension_hello`, `query_extension`, `set_branch_routing`, `ping`
- **server → client:** `event`, `done`, `error`, `worktree_state`,
  `project_event`, `extension_status`, `pong`

The mirror only depends on `subscribe` → `event` / `done` / `error`; the rest are
dock/worktree/extension/relay concerns.

### Dock-only

Served by both plugins but only consumed when `dock: true`. Not required for the
widget or the offline mirror; an integration can skip them entirely and still
have the full click→comment→agent loop. (`GET /__pinagent/dock/<path>` static
assets, plus `branches`, `changes`, `changes/:id/diff`, `working-copy`,
`working-copy/{pr,push,branch}`, `git-branches`, `worktree-servers`,
`branches/{prune-stale,bulk-prune,:id,:id/serve}`, `prs`, `prs/refresh`,
`history`, `audit-log`, `files`, `connections`, `connections/{github,anthropic}`,
`settings`, `feedback/{bulk-update,bulk-reopen}`, `extension.vsix`.)

---

## 4. Recovery semantics

**Subscribe always replays the full transcript.** The event bus is SQLite-backed
(`packages/agent-runner/src/bus.ts`): every `publish` is one INSERT into
`messages`, and `subscribe` replays everything written so far for that feedback
id on its first poll, then tails new rows. There is no "catch-up from cursor"
handshake — a fresh subscribe is always a full replay. (This is deliberate:
Vite-style dual-context module loading would split an in-memory bus into separate
instances and drop cross-process events; SQLite is the one thing every context
agrees on.)

Because a reconnect re-runs that full replay, the client must clear its copy
first or it would render every event twice. The flow:

1. The WS client reconnects (`packages/widget/src/ws-client.ts`). On the
   `open` event, **if this is a reconnect** (not the first connect), it calls
   `handler.onReset()` for each subscribed conversation *before* re-sending
   `subscribe`.
2. `onReset` (`packages/widget/src/stream-handler.ts`) clears the rendered log
   and enqueues `deleteConversationMessages(db, feedbackId)` onto the
   conversation's serial **`dbWriteChain`**.
3. Because every mirror write rides that same single chain, the delete is
   enqueued *ahead of* the replayed re-inserts, so it always lands first and the
   replay rebuilds **exactly one** copy in both the DOM and the mirror.

### Offline truth-table

| State | What works | What's lost / degraded |
|---|---|---|
| **Server up** | everything — live stream, mirror writes, agent runs | — |
| **Server down (but page alive)** | reading cached transcripts from the mirror; the widget UI stays responsive | new `POST /__pinagent/feedback` **fails and is dropped** — there is no client-side outbox (ticket [`002`](../../todo/002-rn-failed-submit-draft-retention.md) / [`004`](../../todo/004-widget-persist-followup-queue.md)); the live WS stream stalls |
| **Connection lost mid-run, then recovers** | on reconnect the client wipes the conversation's mirrored `messages` and the server replays the full transcript, landing exactly once; unsent follow-ups (still in memory) flush after the replay | events that arrived only while disconnected are recovered via replay, not via a queued delta — so nothing is missed, but there's a visible gap until the reconnect lands |

The honest wart here is the **missing POST outbox**: a feedback submission while
the server is unreachable is not retried. The mirror is a read/replay convenience,
not a write-ahead log.

---

## 5. Per-integration status

| Integration | Offline layer | Notes |
|---|---|---|
| **Web — Vite** | full | serves all four mirror assets + feedback REST + WS; OPFS mirror survives reload |
| **Web — Next.js** | full | same surface via `app/pinagent/[[...slug]]/route.ts`; OPFS mirror survives reload |
| **Web — Nuxt** | full | `@pinagent/nuxt-plugin` wraps `@pinagent/vite-plugin`, so it inherits the same surface |
| **React Native** | none (by design) | **server-rehydrate model.** The Metro middleware serves only `POST /__pinagent/feedback`, `POST /__pinagent/open`, and `WS /__pinagent/ws` — there is no SQLite-WASM, no device-local store. State is rehydrated from the server on each app start (work tracked in tickets [`001`](../../todo/001-rn-restore-conversations-after-reload.md) / [`002`](../../todo/002-rn-failed-submit-draft-retention.md)). See [`react-native.md`](./react-native.md). |
| **Dock** | none (by design) | the dock talks HTTP/WS straight to the host server (TanStack Query + WS), with no offline mirror layer; it's a project-management surface, not a reload-survival cache |

---

## 6. Non-goals

- **Multi-tab SAH coordination.** The OPFS SAH Pool VFS holds an exclusive sync
  access handle on `pinagent.sqlite`. A second tab can't open it and falls back
  to `:memory:`. We don't coordinate a shared writer across tabs.
- **Cross-device sync.** The mirror is per-browser-profile. There is no
  device-to-device replication; the server's SQLite file is the only shared
  state.
- **Production usage.** The whole layer is dev-only — middleware and WS bind to
  `127.0.0.1` and everything is gated on `NODE_ENV !== 'production'`.
- **A client-side write outbox.** Failed `POST /__pinagent/feedback` submissions
  are not queued and retried (see §4). If that changes, it'll be a deliberate
  feature, not a quiet expansion of the mirror's job.

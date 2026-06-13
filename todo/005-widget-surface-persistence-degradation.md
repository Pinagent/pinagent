# 005 — widget: surface `:memory:` persistence degradation

- **Priority:** P3
- **Packages:** `@pinagent/browser-runtime`, `@pinagent/widget`
- **Zone:** Apache-2.0
- **Changeset:** both packages are changeset-ignored, **but** both ship inside the plugins
  (browser-runtime's worker source is served by them; the widget IIFE is embedded) → add
  changesets bumping BOTH `@pinagent/vite-plugin` and `@pinagent/next-plugin` (patch), re-run
  `pnpm generate:plugin-widget-embed`, keep `pnpm lint:widget-cascade` green
- **Read `/todo/README.md` ground rules first**

## Context

The SQLite worker prefers the OPFS SAH Pool VFS and silently falls back to `:memory:` when
SAH install fails (`packages/browser-runtime/src/db-worker-source.ts:86-95`):

```ts
} catch (err) {
  console.warn('[pinagent:sqlite-worker] backend: :memory: (no persistence) — SAH install failed:', err);
  db = new sqlite3.oo1.DB(':memory:');
}
```

The two real-world triggers are (a) browsers/contexts without OPFS SAH (older Safari,
private windows) and (b) **a second tab of the same app** — only one worker can hold the SAH
handles, so the second tab degrades. In all cases the only signal is a console line; the
widget UI behaves identically, and the user discovers on reload that their conversation
history is gone. The client (`packages/widget/src/db/client.ts:152-158` init sequence) never
learns which backend it got.

## Expected behavior

The widget knows which backend the worker landed on and gives the developer a quiet but
discoverable signal when persistence is off — including the "another tab probably holds the
lock" hint — without nagging or blocking anything.

## Implementation notes

1. **Worker → client:** include the backend in the `'init'` response payload
   (`db-worker-source.ts` message handler), e.g. `{ ok: true, backend: 'opfs' | 'memory' }`.
   Keep the protocol backward-compatible: client treats a missing field as `'opfs'`
   (old worker + new client and vice versa can briefly coexist via plugin-dist staleness).
   Note `db-worker-source.ts` exports the worker *source string* — edit carefully and keep
   it dependency-free.
2. **Client:** surface it from `initBrowserDb` (`client.ts`) as part of the resolved handle.
3. **Widget UI:** one subtle, non-modal affordance — suggestion: a small dot/`title` on the
   FAB plus a one-time dismissible note in the composer footer: "History won't survive
   reload in this tab (another tab may hold the storage lock)." No periodic toasts.
4. Mention the limitation + multi-tab cause in `packages/widget/README.md` (the "Local
   cache" section, near line 52).

## Acceptance criteria

- [ ] Forcing SAH failure (e.g. open the example app in two tabs) shows the indicator in the
      degraded tab only; the healthy tab is unchanged.
- [ ] Init payload change is tolerated by an old-shape worker response (no field → assumed
      persistent, no crash).
- [ ] Embeds regenerated; vite-plugin + next-plugin changesets present; widget-cascade lint
      green.

## Test plan

`packages/widget/tests/` (happy-dom): unit-test the client's handling of both init payload
shapes (with/without `backend`), and the UI state toggle given `backend: 'memory'`. The real
OPFS/SAH path can't run in vitest — the worker protocol contract is the testable seam.
Manual two-tab check against `pnpm example`.

## Out of scope

- Cross-tab coordination (BroadcastChannel lock handoff, SharedWorker) — out of proportion
  for a dev tool; the mirror is rebuildable from the server anyway.
- Changing the fallback itself (it's correct — the UI must keep working).

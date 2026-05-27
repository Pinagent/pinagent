# @pinagent/browser-runtime

In-browser runtime for Pinagent. Today the package's sole job is to ship the source for the SQLite-WASM Web Worker that backs the widget's local conversation cache. The host plugins (`@pinagent/vite-plugin`, `@pinagent/next-plugin`) import the string and serve it verbatim at `/__pinagent/db-worker.js`; the widget then spawns it with `new Worker(url, { type: 'module' })`.

This package is Node-imported at build time, never bundled — the string is the artifact.

## Why a custom worker

`@sqlite.org/sqlite-wasm`'s upstream `worker1` wrapper only auto-registers the OPFS VFS when the page is **cross-origin-isolated** (COOP/COEP set). Next.js dev doesn't set those headers by default, so the upstream worker falls back to `:memory:` and logs `no such vfs: opfs`. Persistent state would die on every reload.

This worker installs the **OPFS SAH Pool VFS** instead. SAH (`FileSystemSyncAccessHandle`) is Worker-only but doesn't need COOP/COEP, so OPFS persistence works in plain Next/Vite dev. If even SAH is unavailable (very old browsers or another tab holding the access handle), the worker falls back to `:memory:` and logs one clean line about the downgrade.

## Wire protocol

The worker speaks a small `postMessage` protocol, simpler than upstream's `worker1` wrapper:

```ts
// client → worker
{ id, type: 'init', args: { dbName?: string } }
{ id, type: 'exec', args: { sql, bind?: unknown[] } }

// worker → client
{ type: 'ready' }                       // sent once at startup
{ id, ok: true }                        // init / exec with no rows
{ id, ok: true, rows: unknown[][] }     // exec with results
{ id, ok: false, error: string }        // any failure
```

The widget package owns the typed client (`@pinagent/widget/db/client`). Schema + migrations come from `@pinagent/db` — the worker just executes the SQL the client sends.

## Console noise filtering

The worker patches `console.warn` / `console.error` at boot to drop two expected log lines from sqlite-wasm:

- `Ignoring inability to install OPFS sqlite3_vfs: Missing SharedArrayBuffer…` — about the *basic* opfs VFS, which we deliberately don't use.
- `pinagent: NoModificationAllowedError: …createSyncAccessHandle…` — fires when a second tab is holding the OPFS lock. The fallback path logs its own clean line; the raw trace is noise.

Both are prefixed by the VFS name (`pinagent`) we passed to `installOpfsSAHPoolVfs`, which makes them safe to filter.

## Build

```bash
pnpm --filter @pinagent/browser-runtime build
```

Produces ESM + CJS under `dist/` via `tsdown`. Both bundles re-export `DB_WORKER_SOURCE` as a string constant.

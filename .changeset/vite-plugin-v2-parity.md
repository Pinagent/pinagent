---
'@pinagent/vite-plugin': minor
---

Bring `@pinagent/vite-plugin` to v2 parity with `@pinagent/next-plugin`.
Each submitted comment now spawns a `@pinagent/agent-runner` SDK run
that streams progress (text, tool calls, `ask_user` prompts, result/cost)
into the widget over WebSocket — the same UX Next users get.

Breaking-ish: the `autoTrigger` option is removed in favor of
`spawnAgent: 'worktree' | 'inline' | 'off' | false` (default `'inline'`),
mirroring `@pinagent/next-plugin`'s API. The old `AutoTrigger` class and
its batching behavior are gone — runs are per-submit now, with isolation
via the optional worktree mode.

New middleware routes (all mirror `@pinagent/next-plugin/route`):
- `POST /__pinagent/open` — spawn the developer's editor at file:line:col.
- `GET /__pinagent/sqlite-wasm/<file>` — proxy sqlite-wasm jswasm files.
- `GET /__pinagent/db-migrations` — drizzle migration journal + SQL.
- `GET /__pinagent/db-worker.js` — SQLite-WASM worker source.

`GET /__pinagent/widget.js` now ships a `window.__pinagentConfig` prelude
with the WebSocket URL, identical to the Next plugin's bundle. The WS
server boots on port 53636 (overridable via `PINAGENT_WS_PORT`) from
`configureServer`; singleton-guarded so Vite restarts don't fight for
the port.

Drizzle migrations are now shipped with the package via a new prebuild
step (`scripts/copy-drizzle.mjs`) that mirrors `packages/next-plugin/drizzle/`
into `packages/vite-plugin/drizzle/`. Single source of truth, copied at
build time, gitignored locally.

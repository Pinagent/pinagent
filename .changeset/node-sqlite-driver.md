---
'@pinagent/agent-runner': minor
'@pinagent/mcp': minor
'@pinagent/next-plugin': minor
'@pinagent/vite-plugin': minor
---

Replace `better-sqlite3` with Node's built-in `node:sqlite` module
(stable since Node 22.13; our `engines.node: ">=22.18.0"` already
requires a compatible version). Same underlying SQLite engine and
on-disk format — no data migration needed.

Why: `better-sqlite3` ships a native `.node` binary that pnpm 10+
blocks from compiling by default, producing a runtime
`Could not locate the bindings file` 500 on the first feedback
submission. Documented workaround was `pnpm approve-builds` +
reinstall. With `node:sqlite`, fresh installs need no approval
step at all.

Wiring: drizzle-orm doesn't ship a node-sqlite adapter yet, so we
route through `drizzle-orm/sqlite-proxy` with a small callback
that delegates to `node:sqlite`'s `DatabaseSync`. The storage
layer already `await`s every query, so call sites are unchanged.
Migrations are applied by a tiny in-house migrator that mirrors
the browser-side pattern (`packages/widget/src/db/migrations.ts`)
and tracks applied versions in `__drizzle_migrations` (same shape
drizzle's stock migrator writes).

Verified: fresh `pnpm add -D @pinagent/vite-plugin` in a scratch
project produces no `approve-builds` prompt and no native modules
in the install graph. 224/224 tests pass.

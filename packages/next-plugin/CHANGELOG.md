# @pinagent/next-plugin

## 0.1.0

### Minor Changes

- 8c028bf: Replace `better-sqlite3` with Node's built-in `node:sqlite` module
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

## 0.0.21

### Patch Changes

- 77a6e90: Inline `@pinagent/*` workspace packages into the published `next-plugin`
  and `vite-plugin` tarballs so end users don't need workspace packages
  available at install time. Workspace deps moved to `devDependencies`;
  the npm-shaped transitive deps (`@anthropic-ai/claude-agent-sdk`,
  `@babel/*`, `better-sqlite3`, `drizzle-orm`, `ws`, `zod`, `nanoid`) are
  declared as runtime `dependencies` on the consumer plugins. Verified by
  inspecting the built CJS bundles: no more `require("@pinagent/...")`
  calls in `dist/route.cjs` or `dist/index.cjs`.
- 64d17ce: Move `db-worker-source.ts` (the SQLite-WASM Web Worker source string) out
  of `@pinagent/agent-runner` and into `@pinagent/browser-runtime`, where it
  fits architecturally — the file is browser-side code, not agent runtime.
  `@pinagent/next-plugin/route` now imports `DB_WORKER_SOURCE` from
  `@pinagent/browser-runtime`; no externally observable change.
- 640e0d2: Phase G — re-anchor widgets on HMR / DOM rewrites. When the host app's
  framework replaces a widget's anchor Node (Vite HMR, React re-render,
  Next 16 RSC swap), the widget's rAF position loop now detects the stale
  reference (`composer.target.isConnected === false`) and tries to relocate
  the element by `data-pa-loc` first (precise `<file>:<line>:<col>` match
  from `@pinagent/babel-plugin`), CSS selector second. On success the new
  target is swapped in silently. On failure the bubble flips to a dashed
  amber "anchor-lost" ring with a tooltip prompting the user to click it
  and retry the lookup — visible failure instead of the widget freezing at
  stale coordinates.

  No protocol change. No server-side change. Pure widget IIFE work.

- f412e9f: Phase H finishing touch: surface the branch name and uncommitted-files
  count in the widget's lifecycle row, matching the v2 plan spec
  `pinagent/<id> · 3 changes · [Land] [Discard]`.

  Server (`@pinagent/agent-runner`) adds `countWorktreeChanges(worktreePath)`
  and includes the result as `changesCount` on `worktree_state` broadcasts
  emitted from the subscribe path. The widget uses it (alongside the
  `pinagent/<feedbackId>` branch name, which is deterministic) to render
  labels like `pinagent/abc123def · 3 changes` for `active`, and
  `Old worktree · pinagent/abc123def · 3 changes — review or discard` for
  `ttl_warning`. When the count is unknown (worktree gone, git failure)
  the count is omitted rather than guessed.

  Wire format change: `ServerMessage` of type `worktree_state` gains an
  optional `changesCount?: number` field. Backwards-compatible — older
  widgets/servers ignore the unknown field.

- 58e880d: Refactor: extract shared modules (`event-bus`, `ws-protocol`) into
  `@pinagent/shared`, the JSX transform + webpack loader into
  `@pinagent/babel-plugin`, and the Agent SDK runtime (agent, ws-server,
  storage, worktree management, `ask_user`, db client) into
  `@pinagent/agent-runner`. `@pinagent/next-plugin` is now a thin Next adapter
  over `@pinagent/agent-runner`; `@pinagent/vite-plugin` shares the same
  storage layer and JSX transform. No externally observable API changes —
  `@pinagent/next-plugin/loader` and `@pinagent/next-plugin/route` still
  work as before.

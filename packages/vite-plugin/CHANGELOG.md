# @pinagent/vite-plugin

## 0.1.0

### Minor Changes

- a4a55cd: Bring `@pinagent/vite-plugin` to v2 parity with `@pinagent/next-plugin`.
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

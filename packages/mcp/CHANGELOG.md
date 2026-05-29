# @pinagent/mcp

## 0.2.0

### Minor Changes

- cf3dc7e: `get_feedback` now surfaces enclosing-component and loop-instance
  context when present: the `component` name, the `component path`
  (outer→inner chain), and — when the target's `file:line` is shared by
  several rendered instances — which instance the developer clicked plus a
  content fingerprint. This helps an MCP-driven agent edit the correct
  `.map()` item rather than the first match. Fields are omitted for
  single-pick / uninstrumented feedback, so existing output is unchanged.

### Patch Changes

- 99a1519: Publish `@pinagent/cli` and fix `@pinagent/mcp` packaging.

  `@pinagent/mcp@0.1.0` was uninstallable from npm: it declared the private,
  unpublished `@pinagent/db` (and `@pinagent/shared`) as runtime `dependencies`,
  so a clean `npm install @pinagent/mcp` failed with a 404 on `@pinagent/db`.
  Those internal packages now live in `devDependencies` so tsdown bundles them
  into the published dist (the same pattern `@pinagent/vite-plugin` and
  `@pinagent/next-plugin` already use). A clean install now resolves with no
  dangling internal dependencies.

  `@pinagent/cli` becomes publishable (was `private`): it adds
  `publishConfig.access: public` and a `prepare` build hook, keeps a thin runtime
  dependency on `@pinagent/mcp`, and bundles `@pinagent/shared`. This makes
  `pnpm dlx @pinagent/cli mcp` (and `pinagent init` / `pinagent transcript`)
  work without a local checkout.

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

## 0.0.2

### Patch Changes

- 6520e38: Export `startMcpServer` so `@pinagent/cli`'s new `pinagent mcp` subcommand
  can drive the server in-process. The package's bin entry still auto-starts
  when invoked directly (`pinagent-mcp`), gated by an `import.meta.url` check
  that skips the auto-start when the module is imported as a library.

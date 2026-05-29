# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pinagent lets a developer click a UI element in their dev server, leave a comment, and have a coding agent pick it up with `file:line` + a screenshot. It's a localhost-only Vite/Next.js dev plugin that tags JSX with source locations, injects a browser widget, persists feedback to a local SQLite DB under `.pinagent/`, and exposes the queue over an MCP server. An optional **dock** UI (off by default, `dock: true`) adds project-management surfaces (conversations, diffs, PR composer, worktrees).

The repo is a pnpm + turbo monorepo with **two licensing zones** (see Conventions).

## Commands

```bash
pnpm install              # Node 22+ and pnpm 10+ required (pinned in .nvmrc / packageManager)
pnpm build                # turbo run build across the whole workspace
pnpm build:oss            # build only packages/* (what `release` ships)
pnpm typecheck            # turbo run typecheck
pnpm test                 # vitest run (root config picks up packages/*/tests + apps/*/tests)
pnpm test:watch           # vitest watch
pnpm lint                 # biome check . (formatting + lints)
pnpm lint:fix             # biome check --write .
```

Run a single test file or test by name:

```bash
pnpm test packages/agent-runner/tests/storage.test.ts
pnpm test -t "resolves feedback"
```

Run the example apps against the local packages (these exercise the full click→agent loop):

```bash
pnpm example                          # examples/react-vite on :5173
pnpm --filter next-app-example dev    # examples/next-app on :3000
```

The extra `lint:*` scripts in `package.json` are what CI runs as pre-merge gates — see Conventions for what each enforces. Run them before pushing if you touched packaging, deps, or license headers:
`lint:deps` (sherif), `lint:spdx`, `lint:workspace-deps`, `lint:undeclared-imports`, `lint:widget-cascade`, `lint:peer-deps`.

## Architecture

### The feedback loop (read README.md's diagram first)

1. **Build-time tagging.** `@pinagent/babel-plugin` rewrites JSX to add `data-pa-loc="src/Foo.tsx:42:7"`. Vite consumes it directly; Next.js wraps it in a webpack/Turbopack loader (`packages/next-plugin/src/loader.ts`).
2. **Browser widget.** `@pinagent/widget` (shadow-root UI) walks up from the clicked node to the nearest `data-pa-loc`, snaps a screenshot, and POSTs the feedback record to `/__pinagent/feedback`.
3. **Dev-server middleware.** Each plugin mounts a `/__pinagent` middleware that writes rows to `.pinagent/db.sqlite` and a screenshot to `.pinagent/screenshots/<id>.png`.
4. **Agent.** Either the in-process `@pinagent/agent-runner` (default `spawnAgent: 'inline'`, streams over WebSocket back into the widget) or, externally, a Claude Code session connected to `@pinagent/mcp` reads the queue, edits files, and calls `resolve_feedback`.

### Package map (`packages/*`, all `@pinagent/*`)

- **`vite-plugin` / `next-plugin`** — the two entry points. Both embed the widget IIFE at build time, mount the `/__pinagent` middleware/route, and back `spawnAgent`. `next-plugin` additionally ships `<Pinagent />` (`component.tsx`), a route handler (`route.ts`), and `*-noop` variants gated on `NODE_ENV !== 'production'`.
- **`db`** — Drizzle schema (`schema.ts`) + a re-export of drizzle operators. Shared by the server (Node's built-in `node:sqlite`) and the browser cache (`@sqlite.org/sqlite-wasm`). **Server-side SQLite is the source of truth; the browser store is a rebuildable mirror.**
- **`agent-runner`** — SDK-driven local runtime. `agent.ts` (spawn / follow-up / worktree merge), `bus.ts` (event bus), `storage.ts` (Storage facade over the DB), `ws-server.ts`, plus dock backends: `pr-composer`, `branches`, `changes`, `pull-requests`, `secrets-store`, `settings-store`, `audit-log`, `ask-user`.
- **`mcp`** — stdio MCP server + the `pinagent-mcp` bin. Reads the same `.pinagent/db.sqlite`.
- **`widget`** — per-element browser UI. `private: true`, never published — it's embedded into the plugins (see widget cascade rule).
- **`widget-dock`** — opt-in React/TanStack project-management SPA (`dock: true`).
- **`ui`** — shared component/token library (radix-ui, tailwind-merge, cva).
- **`babel-plugin`, `browser-runtime`, `shared`** — internal helpers (`shared` holds the WS protocol, dock API/postmessage contracts, transcript rendering).
- **`vscode-extension`** — optional `vscode://` bridge for handing a dock conversation into a Claude Code terminal.

`apps/cli` (Apache) wraps the OSS packages as the `pinagent` CLI (`pinagent mcp`). `apps/cloud` and `ee/packages/*` (auth, billing, infra, relay, team-features) are the Elastic-zone hosted-service code.

### Two subtle data-flow facts

- **The `messages` table IS the event-stream source of truth.** The bus writes every publish straight to SQLite and subscribers poll it. This is deliberate: Vite's dual-context module loading would otherwise split an in-memory bus into separate instances and drop cross-process events. Don't "optimize" this into an in-memory-only bus.
- **Single drizzle instance.** Consumers import drizzle operators (`eq`, `and`, …) from `@pinagent/db`, not from `drizzle-orm` directly, because pnpm peer-deduping can otherwise create multiple `drizzle-orm` identities that don't interoperate.

## Conventions

### Licensing zones (this gates where a patch can land)

- `packages/*`, `examples/*`, `apps/cli/` → **Apache-2.0**. OSS; external PRs welcome.
- `ee/*`, `apps/cloud/` → **Elastic-2.0**. Source-available; **no external PRs accepted**.
- Rule of thumb: runs on the developer's machine → Apache; runs as a hosted multi-tenant service → Elastic.
- **Every source file needs an SPDX header on line 1**: `// SPDX-Identifier` is `Apache-2.0` for OSS trees, `Elastic-2.0` under `ee/` and `apps/cloud/`. Copy from a neighbouring file. `__generated__/` files are exempt. Enforced by `pnpm lint:spdx`.

### Build & embedding gotchas

- **Widget cascade.** `@pinagent/widget` is embedded into `vite-plugin` and `next-plugin` as an IIFE at build time (each plugin's `scripts/embed-widget.mjs` → `src/__generated__/widget.ts`, also run via `pnpm generate:plugin-widget-embed`, which `pretest` triggers). A widget IIFE change MUST be paired with a changeset bumping **both** consumer plugins, or the new bytes ship to nobody. `pnpm lint:widget-cascade` enforces this.
- **Stale plugin dist** is the usual cause of a 500 on `POST /__pinagent/feedback` in the examples — `pnpm build` forces a clean rebuild.
- **No native SQLite at runtime.** The server uses Node's built-in `node:sqlite` (`DatabaseSync`, stable since 22.13) — see `packages/agent-runner/src/db/client.ts` — so there's no native build step and no `pnpm approve-builds` for the click→comment→agent loop. `better-sqlite3` survives only as a `@pinagent/widget` *test* dependency (an in-memory DB in the test helpers); it's listed in `pnpm-workspace.yaml`'s `onlyBuiltDependencies` (so a plain `pnpm install` builds it) and externalized in `vitest.config.ts` so Vite's resolver doesn't try to transform it.

### Schema changes

Editing `packages/db/src/schema.ts` requires generating a migration: `pnpm --filter @pinagent/db drizzle:gen`. The server applies migrations automatically on connect. Several columns use text (not enums) intentionally so new event types / actions / states land without a migration.

### Tests

Vitest default env is Node. Tests needing a DOM annotate the file with `// @vitest-environment happy-dom` at the top. Put tests in `packages/<pkg>/tests/` (auto-discovered).

### Commits & changesets

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`), one logical change per commit.
- If a PR touches a **publishable** `packages/*`, add a changeset (`pnpm changeset`). Many packages are excluded from changesets (`ee/*`, `apps/cloud`, and notably `widget`, `shared`, `babel-plugin`, `browser-runtime`, `agent-runner`, examples — see `.changeset/config.json`).

### Code style

Biome (`biome.json`): 2-space indent, 100-col, single quotes, semicolons, trailing commas. `noExplicitAny` is a warning; `noNonNullAssertion` is off.

## Invariants (do not break)

- **Localhost only** — middleware and WebSocket bind to `127.0.0.1`. **No auth** — the trust boundary is the developer's own machine.
- **Dev-only** — loader, widget, and middleware are gated on `NODE_ENV !== 'production'`; production builds are untouched.
- **Local SQLite is the source of truth** — no daemon, no socket; the plugin writes and the MCP server reads the same `.pinagent/db.sqlite`.

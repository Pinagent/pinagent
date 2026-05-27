# @pinagent/db

Shared Drizzle schema for Pinagent. The same TypeScript schema drives both the dev-side SQLite database (via `better-sqlite3`) and the browser-side cache (via `@sqlite.org/sqlite-wasm`), so the server's source of truth and the widget's local mirror can't drift out of sync.

This package is private and never published. Framework adapters (`@pinagent/next-plugin`, `@pinagent/vite-plugin`) copy the generated `drizzle/` folder into their dist tree at build time so consumer apps ship the migrations transitively.

## What lives here

- **`src/schema.ts`** — the entire persistent schema. Six tables: `conversations`, `widget_anchors`, `messages`, `active_runs`, `pull_requests`, `audit_events`.
- **`src/index.ts`** — the schema plus a curated re-export of `drizzle-orm` operators (`and`, `eq`, `desc`, …). Consumers import operators from `@pinagent/db` rather than `drizzle-orm` directly so the workspace stays on one drizzle identity even when pnpm peer-dedup creates phantom copies.
- **`drizzle/`** — generated SQL migrations + drizzle-kit metadata. Version-controlled so migration history is reviewable in PRs.

## The two clients

| Client                          | Where                                  | Role                                                          |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `better-sqlite3`                | Server (`@pinagent/agent-runner`)      | Source of truth — owns agent runs, log files, worktrees.      |
| `@sqlite.org/sqlite-wasm`       | Browser (`@pinagent/browser-runtime`)  | Local mirror of conversations the current page cares about.   |

The browser store is rebuildable: if it ever diverges from the server it's blown away and re-hydrated. The server never reads from the browser.

## Tables (quick map)

- **`conversations`** — one row per developer comment. Carries `status` (developer intent), `worktreeState` (lifecycle of the agent's worktree), the optional `title` override (NULL falls back to a comment-derived default), and `archived` flag.
- **`widget_anchors`** — DOM anchor metadata captured at pick time (file:line from `data-pa-loc`, CSS selector fallback, cursor x/y, viewport). Used to re-anchor a comment across HMR / reloads.
- **`messages`** — append-only transcript of agent events. One row per `AgentEvent` plus user follow-ups. `content` is opaque JSON so the schema doesn't churn when new event types ship. Live streaming still flows through the in-memory event bus in `@pinagent/shared`; this table is the durable record + browser cache.
- **`active_runs`** — one row per in-flight SDK run. `awaitingAskId` lets the widget render a pending `ask_user` question authoritatively on a fresh page load.
- **`pull_requests`** — one row per PR the dock's compose flow opens. `conversationIds` is a JSON array of the feedback ids bundled into the PR.
- **`audit_events`** — append-only audit trail (`conversation_created`, `conversation_landed`, `conversation_renamed`, `pr_created`, …). `action` is text rather than an enum so new actions land without a migration.

Each table exports inferred `Foo` (select) and `NewFoo` (insert) types so consumers don't restate column lists.

## Changing the schema

1. Edit `src/schema.ts`.
2. Generate a migration:
   ```bash
   pnpm --filter @pinagent/db drizzle:gen
   ```
3. Review the SQL drizzle-kit produced under `drizzle/` and commit both the schema change and the migration file.
4. Optionally lint:
   ```bash
   pnpm --filter @pinagent/db drizzle:check
   ```

The server applies pending migrations on connect — there's no manual `db:migrate` step. The browser runtime runs the same set of migrations against its WASM database so the two stay in lockstep.

When changing column shape:
- Defaults that need to populate existing rows go in the migration SQL, not in the schema default — drizzle's `.default(...)` is a NEW-row default and won't backfill.
- Adding columns is safe. Renaming or dropping is not (the browser cache may be running an older version); add new + migrate data + drop in a later release.

## Build

```bash
pnpm --filter @pinagent/db build
```

Produces dual ESM + CJS output under `dist/` (via `tsdown`). The `./schema` subpath export is for consumers that want only the schema without the operator re-exports.

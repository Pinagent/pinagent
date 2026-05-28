# Pinagent

Click a UI element in your dev server, leave a comment, and your coding agent picks it up — with `file:line` and a screenshot — over MCP.

Pinagent is a localhost-only Vite or Next.js plugin. It tags every JSX element with its source location, drops a small 💬 widget into the page, and persists each captured comment to a local SQLite database under `.pinagent/`. An MCP server surfaces the queue inside your existing Claude Code session, so the next thing you say can be "fix the pending feedback."

There's also an opt-in **dock** surface (`@pinagent/widget-dock`) — a project-management UI for browsing conversations, reviewing diffs, composing PRs from resolved comments, and managing worktrees. Off by default; flip on with `dock: true` on either plugin.

## Try the bundled example in two minutes

The fastest way to see the loop end-to-end is the React + Vite example in this repo:

```bash
pnpm install                                # from the repo root
pnpm --filter react-vite-example dev
```

The example's `predev` hook builds `@pinagent/vite-plugin` (and its upstream packages via turbo) before starting Vite, so the dev server boots with a fresh plugin bundle that has the widget, the migrations, and the agent runtime baked in.

1. **Open** <http://localhost:5173>. You should see a "Pinagent demo" header with three counters.
2. **Click the Pinagent logo** in the bottom-right corner. A picker activates and your cursor highlights elements as you hover.
3. **Click a counter** (e.g. "Apples"), type a comment ("rename to Potato"), submit.
4. **Watch the widget pane** that opens next to the element — the Claude Agent SDK runs against `examples/react-vite/`, streaming text, tool calls, and the resulting edit back into the page.
5. **Verify** in your editor that `examples/react-vite/src/App.tsx` was changed — Pinagent calls `mcp__pinagent__resolve_feedback` when it's done.

The full feedback record persists to a local SQLite database at `.pinagent/db.sqlite`, and the captured screenshot lives at `.pinagent/screenshots/<id>.png` (both under the example's project root).

If the dev server returns 500 on `POST /__pinagent/feedback`, the plugin dist is stale — `pnpm build` from the repo root forces a clean rebuild. See [examples/react-vite/README.md](./examples/react-vite/README.md) for more.

The Next.js example works the same way:

```bash
pnpm --filter next-app-example dev          # :3000
```

## How it works

```
   browser                      dev server                    agent
┌────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│ click element  │    │  /__pinagent middleware  │    │  Claude Code     │
│ leave comment  │──▶ │  writes rows to          │──▶ │  + @pinagent/mcp │
│ widget snaps   │    │  .pinagent/db.sqlite     │    │  reads, edits,   │
│ a screenshot   │    │  + screenshots/<id>.png  │    │  resolves        │
└────────────────┘    └──────────────────────────┘    └──────────────────┘
        ▲                                                       │
        └────── data-pa-loc="src/Foo.tsx:42:7" ──── resolves ───┘
```

JSX is tagged at dev-build time by `@pinagent/babel-plugin` (Vite) or a webpack/Turbopack loader (Next.js). The widget walks up from the clicked node, finds the nearest `data-pa-loc`, and POSTs `{ comment, file, line, col, selector, url, viewport, screenshot }` to `/__pinagent/feedback`.

## Install

```sh
pnpm add -D @pinagent/vite-plugin    # or @pinagent/next-plugin
```

### Native build approval (pnpm only)

pnpm 10+ blocks postinstall build scripts by default. Pinagent's agent runner uses `better-sqlite3` server-side, which needs its native `.node` binding compiled — otherwise comment submission returns a 500 with:

```
Could not locate the bindings file. Tried: .../better-sqlite3/build/Release/better_sqlite3.node ...
```

Pick one:

```sh
pnpm approve-builds                  # interactive; select better-sqlite3 in the picker
pnpm install                         # re-run so the postinstall actually fires
```

Or — non-interactive, useful for team setup scripts — add to your project's `package.json`:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

…then `pnpm install`. Same outcome, no prompt.

(npm and yarn build native binaries by default, so this step only matters on pnpm.)

**Vite** (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pinagent from '@pinagent/vite-plugin';

export default defineConfig({
  plugins: [pinagent(), react()],
});
```

**Next.js** (`next.config.ts`)

```ts
import pinagent from '@pinagent/next-plugin/config';

export default pinagent({
  /* your existing nextConfig */
});
```

Then add two short files:

```tsx
// app/layout.tsx — somewhere inside <body>
import { Pinagent } from '@pinagent/next-plugin';
<Pinagent />
```

```ts
// app/pinagent/[[...slug]]/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { GET, POST, PATCH } from '@pinagent/next-plugin/route';
```

## Connect your agent

Register the MCP server with Claude Code. The easiest path uses `@pinagent/cli` so you don't need a global install:

```bash
claude mcp add pinagent -- pnpm dlx @pinagent/cli mcp
```

If `@pinagent/mcp` is already installed (e.g. as a project dep), the older direct-bin form also works:

```bash
claude mcp add pinagent pinagent-mcp
```

That's it. In your next Claude Code session, ask it to "address pending Pinagent feedback" and it will call the tools below.

## MCP tools

| Tool | What it does |
|---|---|
| `list_pending_feedback` | Lists open items. Optional `since` (ISO-8601) and `file` (substring) filters. |
| `get_feedback` | Returns one item, with the screenshot as an inline image. |
| `resolve_feedback` | Marks `fixed` / `wontfix` / `deferred`; optional note + commit sha. |
| `get_source_context` | Reads a window of source around a given `file:line`. |

## What gets captured

Each feedback item carries:

- `comment` — free text from the composer
- `file`, `line`, `col` — project-relative, from the `data-pa-loc` attribute
- `selector` — short CSS path; fallback when source mapping is missing
- `screenshot` — PNG, downscaled to ~1280px max width
- `viewport`, `url`, `userAgent`

The plugin persists each item into a local SQLite database at `.pinagent/db.sqlite` and writes the screenshot to `.pinagent/screenshots/<id>.png`. Schema lives in `@pinagent/db`; migrations run automatically on first connect. Add `.pinagent/` to your `.gitignore` — the Vite plugin will warn if you forget.

## Spawn mode

Both plugins auto-spawn an agent when you submit a comment. The default streams the run back into the widget over WebSocket — no need to bounce into Claude Code. Switch off if you'd rather drive the loop from your own MCP-connected session.

```ts
pinagent({ spawnAgent: 'inline' })             // Vite — the default
pinagent(nextConfig, { spawnAgent: 'inline' }) // Next.js — same option, same default
```

| Value         | Effect                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `'inline'`    | Default. Each submit runs the Claude Agent SDK against your project root; events stream into the widget.        |
| `'worktree'`  | Each submit gets its own git worktree at `.pinagent/worktrees/<id>` on branch `pinagent/<id>`. True parallel agents — review each like a PR. |
| `'off'` / `false` | No auto-spawn. Use this when you want to drive the loop manually via the MCP server.                         |

See `packages/agent-runner` for the full surface.

## Dock surface (optional)

The per-element widget is shipped by both plugins automatically. The **dock** is a second surface — a project-management UI that complements the widget — and is off by default. Opt in with `dock: true`:

```ts
pinagent({ dock: true })                       // Vite
pinagent(nextConfig, { dock: true })           // Next.js
```

The dock surfaces a bottom-left FAB that opens panels for Conversations, Changes (with inline diffs), Branches, PRs, Connections, Settings, and History. Routes, keyboard shortcuts, and deep links are documented in [`packages/widget-dock/README.md`](./packages/widget-dock/README.md).

## Project layout

- **`@pinagent/vite-plugin`** — Vite 5–8 plugin: JSX tagging, widget injection, `/__pinagent` middleware.
- **`@pinagent/next-plugin`** — Next.js 14+ adapter (active on Next 16): webpack and Turbopack loaders, route handler, `<Pinagent />` client component.
- **`@pinagent/widget`** — the per-element browser UI (shadow-root button → pick → composer). Embedded by the plugins at build time.
- **`@pinagent/widget-dock`** — opt-in project-management surface (conversations, changes, PR composer, branches, history). Embedded by the plugins when `dock: true`.
- **`@pinagent/cli`** — `pinagent` CLI. Currently exposes `pinagent mcp` (stdio MCP server).
- **`@pinagent/mcp`** — stdio MCP server backing the CLI. Also ships the standalone `pinagent-mcp` bin.
- **`@pinagent/babel-plugin`** — the JSX → `data-pa-loc` transform used by both plugins.
- **`@pinagent/agent-runner`** — SDK-driven local runtime that backs `spawnAgent` in both plugins. WebSocket server, storage, worktree management, `ask_user`.
- **`@pinagent/vscode-extension`** — optional VSCode bridge. Registers a `vscode://` URI handler so the dock can hand a conversation back into a Claude Code terminal. Sideload-only today; see [`packages/vscode-extension/README.md`](./packages/vscode-extension/README.md).
- `@pinagent/browser-runtime`, `@pinagent/db`, `@pinagent/shared`, `@pinagent/ui` — internal.

## Invariants

- **Localhost only.** Middleware and WebSocket bind to `127.0.0.1`.
- **No auth.** The trust boundary is your own machine.
- **Local SQLite is the source of truth.** The plugin writes to `.pinagent/db.sqlite`; the MCP server reads from the same file. No daemon to start, no socket to connect.
- **Dev-only.** The loader, widget, and middleware are gated on `NODE_ENV !== 'production'`. Production builds are untouched.

## Licensing

- **Apache-2.0** — `packages/`, `apps/cli/`, `examples/`. Free for any use. See [LICENSE](./LICENSE).
- **Elastic-2.0** — `ee/` and `apps/cloud/`. Source-available; may not be offered as a hosted service to third parties. See [ee/LICENSE](./ee/LICENSE).

Rule of thumb: if it runs on the developer's own machine, it's Apache-2.0. If it runs as a hosted multi-tenant service, it's Elastic-2.0.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). External PRs are welcome against `packages/*` and `apps/cli/`; we don't accept external PRs against `ee/*` or `apps/cloud/`.

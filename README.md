# Pinagent

Click a UI element in your dev server, leave a comment, and your coding agent picks it up — with `file:line` and a screenshot — over MCP.

Pinagent is a localhost-only Vite or Next.js plugin. It tags every JSX element with its source location, drops a small 💬 widget into the page, and writes each captured comment to `.pinagent/feedback/`. An MCP server surfaces the queue inside your existing Claude Code session, so the next thing you say can be "fix the pending feedback."

## How it works

```
   browser                      dev server                    agent
┌────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│ click element  │    │  /__pinagent middleware  │    │  Claude Code     │
│ leave comment  │──▶ │  writes                  │──▶ │  + @pinagent/mcp │
│ widget snaps   │    │  .pinagent/feedback/<id> │    │  reads, edits,   │
│ a screenshot   │    │  + screenshots/<id>.png  │    │  resolves        │
└────────────────┘    └──────────────────────────┘    └──────────────────┘
        ▲                                                       │
        └────── data-pa-loc="src/Foo.tsx:42:7" ──── resolves ───┘
```

JSX is tagged at dev-build time by `@pinagent/babel-plugin` (Vite) or a webpack/Turbopack loader (Next.js). The widget walks up from the clicked node, finds the nearest `data-pa-loc`, and POSTs `{ comment, file, line, col, selector, url, viewport, screenshot }` to `/__pinagent/feedback`.

## Install

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

export default pinagent(
  { /* your existing nextConfig */ },
  { spawnAgent: 'off' }, // see "Hands-off mode" to flip this on
);
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

Register the MCP server with Claude Code:

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

The plugin writes JSON to `.pinagent/feedback/<id>.json` and the screenshot to `.pinagent/screenshots/<id>.png`. Add `.pinagent/` to your `.gitignore` — the Vite plugin will warn if you forget.

## Hands-off mode (optional)

If you'd rather not bounce into Claude Code for every comment, the per-submit
spawn flow is on by default in both plugins:

```ts
// Vite — defaults to spawnAgent: 'inline'
pinagent({ spawnAgent: 'inline' })

// Next.js — same option, same default
pinagent(nextConfig, { spawnAgent: 'inline' })
```

`inline` runs the Claude Agent SDK against your project root for each comment, streaming events back to the widget over WebSocket. Switch to `worktree` to give each comment its own git worktree at `.pinagent/worktrees/<id>` on branch `pinagent/<id>` — true parallel agents, review each like a PR. Pass `'off'` (or `false`) to disable per-submit spawning entirely. See `packages/agent-runner` for the full surface.

## Project layout

- **`@pinagent/vite-plugin`** — Vite 5/6/7 plugin: JSX tagging, widget injection, `/__pinagent` middleware.
- **`@pinagent/next-plugin`** — Next.js 14+ adapter: webpack and Turbopack loaders, route handler, `<Pinagent />` client component.
- **`@pinagent/mcp`** — stdio MCP server. Ships the `pinagent-mcp` bin.
- **`@pinagent/widget`** — the browser UI (shadow-root button → pick → composer). Embedded by the plugins at build time.
- **`@pinagent/babel-plugin`** — the JSX → `data-pa-loc` transform used by both plugins.
- **`@pinagent/agent-runner`** — SDK-driven local runtime that backs `spawnAgent` in both plugins. WebSocket server, storage, worktree management, `ask_user`.
- **`@pinagent/cli`** — `pinagent` CLI. Currently exposes `pinagent mcp` (stdio MCP server).
- `@pinagent/browser-runtime`, `@pinagent/db`, `@pinagent/shared`, `@pinagent/ui` — internal.

## Invariants

- **Localhost only.** Middleware and WebSocket bind to `127.0.0.1`.
- **No auth.** The trust boundary is your own machine.
- **File system is the message bus** between the plugin and the MCP server.
- **Dev-only.** The loader, widget, and middleware are gated on `NODE_ENV !== 'production'`. Production builds are untouched.

## Try it

```bash
pnpm install
pnpm build
pnpm example                                # examples/react-vite at :5173
pnpm --filter=next-app-example dev          # examples/next-app at :3000
```

Open the URL, click 💬, pick something, submit. Check `.pinagent/feedback/`.

## Licensing

- **Apache-2.0** — `packages/`, `apps/cli/`, `examples/`. Free for any use. See [LICENSE](./LICENSE).
- **Elastic-2.0** — `ee/` and `apps/cloud/`. Source-available; may not be offered as a hosted service to third parties. See [ee/LICENSE](./ee/LICENSE).

Rule of thumb: if it runs on the developer's own machine, it's Apache-2.0. If it runs as a hosted multi-tenant service, it's Elastic-2.0.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). External PRs are welcome against `packages/*` and `apps/cli/`; we don't accept external PRs against `ee/*` or `apps/cloud/`.

# Pinagent

Click a UI element in your dev server, leave a comment, and your coding agent picks it up — with `file:line` and a screenshot — over MCP.

Pinagent is a localhost-only dev plugin for Vite, Next.js, Nuxt, and SvelteKit. It tags every element with its source location — JSX for React, `<template>` markup for Vue SFCs, component markup for Svelte — drops a small 💬 widget into the page, and persists each captured comment to a local SQLite database under `.pinagent/`. An MCP server surfaces the queue inside your existing Claude Code session, so the next thing you say can be "fix the pending feedback."

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

The Next.js, Nuxt, and SvelteKit examples work the same way:

```bash
pnpm --filter next-app-example dev          # :3000
pnpm --filter nuxt-app-example dev           # :3000 (Nuxt + Vue)
pnpm --filter sveltekit-app-example dev      # :5173 (SvelteKit + Svelte)
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

Source is tagged at dev-build time: JSX by `@pinagent/babel-plugin` (Vite) or a webpack/Turbopack loader (Next.js), and Vue SFC `<template>` markup by `@pinagent/vue-plugin` (Vite + Nuxt). The widget walks up from the clicked node, finds the nearest `data-pa-loc`, and POSTs `{ comment, file, line, col, selector, url, viewport, screenshot }` to `/__pinagent/feedback`.

## Install

> **Using Claude Code? Skip the manual steps.** Run `/pinagent-setup` and it detects Vite, Next, or Nuxt, installs the plugin, wires up the config (and the Next route + `<Pinagent />`), registers the MCP server, and sets the tool permissions for you. `pinagent init` does the deterministic parts from the command line.
>
> Don't have the skill yet? Add the marketplace once, then install:
>
> ```bash
> /plugin marketplace add Pinagent/pinagent
> /plugin install pinagent-setup@pinagent
> ```
>
> The manual steps below do the same thing by hand.

```sh
pnpm add -D @pinagent/vite-plugin    # or @pinagent/next-plugin, or @pinagent/nuxt-plugin
```

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
export * from '@pinagent/next-plugin/route';
```

**Nuxt** (`nuxt.config.ts`)

```ts
export default defineNuxtConfig({
  modules: ['@pinagent/nuxt-plugin'],
});
```

No layout or route files needed — the module tags `.vue` SFCs, mounts the
`/__pinagent` middleware, and injects the widget for you. (Plain Vue + Vite apps
use `@pinagent/vite-plugin` directly — it tags `.vue` SFCs as well as JSX.)

## Connect your agent

Register the MCP server with Claude Code. The easiest path uses `pnpm dlx` so you don't need a global install:

```bash
claude mcp add pinagent -- pnpm dlx @pinagent/cli mcp
```

Equivalent lower-level forms: `pnpm dlx @pinagent/mcp` (the server package directly), or `claude mcp add pinagent pinagent-mcp` if `@pinagent/mcp` is already a project dependency.

> Tip: `pnpm dlx @pinagent/cli init` scaffolds the `.gitignore` entry, the `.mcp.json` registration, and (on Next) the route handler for you.

That's it. In your next Claude Code session, ask it to "address pending Pinagent feedback" and it will call the tools below.

## MCP tools

| Tool | What it does |
|---|---|
| `list_pending_feedback` | Lists open items. Optional `since` (ISO-8601) and `file` (substring) filters. |
| `get_feedback` | Returns one item, with the screenshot as an inline image. |
| `resolve_feedback` | Marks `fixed` / `wontfix` / `deferred`; optional note + commit sha. |
| `get_source_context` | Reads a window of source around a given `file:line`. |
| `get_conversation_transcript` | Returns the full agent transcript for one feedback id (every captured event), as text or JSON. |

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

### Opening a worktree's app

In `'worktree'` mode each agent's work lives on its own branch in `.pinagent/worktrees/<id>`, but nothing serves it — so by default you review changes as diffs in the dock. The dock's **Branches** panel adds an **Open app** action that stands up an on-demand dev server rooted at that worktree (on its own free port) and opens it in a new browser tab, so you can interact with the running app.

The launch command is inferred from the worktree's `package.json` (package manager from the lockfile, framework from dependencies). Override it for non-standard setups with `worktreeServeCommand` — a `{port}` placeholder is substituted with the port pinagent picked (if omitted, ` --port <port>` is appended):

```ts
pinagent({ spawnAgent: 'worktree', dock: true, worktreeServeCommand: 'pnpm dev --port {port}' })             // Vite
pinagent(nextConfig, { spawnAgent: 'worktree', dock: true, worktreeServeCommand: 'pnpm dev --port {port}' }) // Next.js
```

> The worktree must have its dependencies resolvable to boot — `git worktree add` shares the repo's tracked files but not `node_modules`. If "Open app" reports the dev server didn't start, check `.pinagent/logs/<id>-serve.log`.

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

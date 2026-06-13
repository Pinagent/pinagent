# @pinagent/nuxt-plugin

A [Nuxt](https://nuxt.com) module for [Pinagent](https://github.com/Pinagent/pinagent). Click a
UI element in your Nuxt dev server, leave a comment, and a coding agent picks it
up with `file:line:col` + a screenshot.

Nuxt's dev bundler is Vite, so this module is deliberately thin: it reuses the
whole `@pinagent/vite-plugin`. That single plugin

1. tags source — Vue SFC `<template>` markup (via `@pinagent/vue-plugin`) and
   any `.tsx`/`.jsx` (via the Babel JSX transform),
2. mounts the `/__pinagent/*` dev middleware, and
3. starts the WebSocket server,

all inside vite-plugin's own module graph. The module's only extra job is to
inject the widget loader into Nuxt's server-rendered HTML, since Vite's
`transformIndexHtml` (how vite-plugin injects it for SPAs) doesn't run for SSR'd
pages.

Everything is **dev-only** (`nuxt.options.dev`) — production builds are
untouched.

## Install

```bash
pnpm add -D @pinagent/nuxt-plugin
```

## Usage

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@pinagent/nuxt-plugin'],

  // optional
  pinagent: {
    // 'inline' (default) | 'worktree' | 'off'
    spawnAgent: 'inline',
    // mount the project-management dock surface too (default: false)
    dock: true,
    // explicit, opt-in agent API key (default: subscription auth)
    apiKey: process.env.MY_PINAGENT_KEY,
    // override the dock's worktree "Open app" command (worktree mode only)
    worktreeServeCommand: 'nuxt dev --port {port}',
  },
});
```

Start the dev server (`nuxt dev`), open the app, and the Pinagent widget loads.
Click any element, leave a comment, and it lands in `.pinagent/` — streamed to a
Claude Agent SDK run (unless `spawnAgent: 'off'`) or available to a Claude Code
session over `@pinagent/mcp`.

## Options

Every option is forwarded verbatim to `@pinagent/vite-plugin` — `pinagent: {…}`
in `nuxt.config.ts` behaves identically to the same options on `pinagent()` in a
Vite app.

| Option                 | Type                              | Default    | Notes                                                                                                                                                                            |
| ---------------------- | --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spawnAgent`           | `'inline' \| 'worktree' \| 'off'` | `'inline'` | When a comment is submitted, spawn a Claude Agent SDK run to address it. `'worktree'` isolates each run in its own git worktree; `'off'` records only (no spawn).               |
| `apiKey`               | `string`                          | _unset_    | Explicit, opt-in agent API key, bridged to the runner as `PINAGENT_AGENT_API_KEY`. **Unset = subscription auth** — Pinagent never reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. |
| `dock`                 | `boolean`                         | `false`    | Mount the project-management dock surface alongside the widget.                                                                                                                 |
| `worktreeServeCommand` | `string`                          | _inferred_ | Command for the dock's worktree "Open app" action (worktree mode). `{port}` is substituted; otherwise ` --port <port>` is appended. Nuxt apps usually want `nuxt dev`.          |

**Not forwarded — `root`.** The vite-plugin `root` option is deliberately
omitted from the Nuxt module and derived from `nuxt.options.rootDir` instead, so
the plugin's Storage and WebSocket server resolve against the directory Nuxt is
actually serving. There is no Nuxt-only option and no implicit env-var fallback
for any of the above.

## How it fits

```
nuxt dev → Vite (addVitePlugin: @pinagent/vite-plugin)
  ├─ transform  .vue / .tsx → data-pa-loc + data-pa-comp
  ├─ /__pinagent/* middleware (feedback, widget.js, dock assets, screenshots, …)
  └─ WebSocket server (agent event stream)
app head (injected by this module, dev-only, body-close):
  ├─ <script src="/__pinagent/widget.js">
  └─ dock iframe loader + host bridge   ← only when dock: true
```

The widget, dock, middleware, agent runtime, SQLite store, and MCP server are
all framework-agnostic and shared with the Vite and Next.js integrations.

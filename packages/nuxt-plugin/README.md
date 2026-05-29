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
  },
});
```

Start the dev server (`nuxt dev`), open the app, and the Pinagent widget loads.
Click any element, leave a comment, and it lands in `.pinagent/` — streamed to a
Claude Agent SDK run (unless `spawnAgent: 'off'`) or available to a Claude Code
session over `@pinagent/mcp`.

## Options

| Option       | Type                              | Default    | Notes                                                                  |
| ------------ | --------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `spawnAgent` | `'inline' \| 'worktree' \| 'off'` | `'inline'` | Forwarded to `@pinagent/vite-plugin`. `'off'` records only (no spawn). |
| `dock`       | `boolean`                         | `false`    | Mount the project-management dock surface alongside the widget.        |

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

# nuxt-app-example

A minimal [Nuxt](https://nuxt.com) app wired to [`@pinagent/nuxt-plugin`](../../packages/nuxt-plugin),
exercising the full click→agent loop in a Nuxt dev server.

## Run it

```bash
pnpm --filter nuxt-app-example dev
```

The `predev` hook builds `@pinagent/nuxt-plugin` (and its dependency
`@pinagent/vite-plugin`) first, then starts `nuxt dev` on http://localhost:3000.
Open the page and the Pinagent widget loads — click any element, leave a
comment, and a Claude Agent SDK run picks it up and edits `app.vue`.

### Drive it from your own agent session instead

```bash
pnpm --filter nuxt-app-example dev:dogfood
```

Runs with `PINAGENT_SPAWN_AGENT=off` so comments are only recorded (no per-submit
spawn). Point a Claude Code session at the queue over MCP (`@pinagent/cli mcp`)
to handle them.

## How it's wired

`nuxt.config.ts` adds `'@pinagent/nuxt-plugin'` to `modules`. The module is
dev-only — it tags this app's `.vue` `<template>` markup with `data-pa-loc`,
mounts the `/__pinagent/*` middleware, starts the WebSocket server, and injects
the widget loader. `nuxt build` is untouched.

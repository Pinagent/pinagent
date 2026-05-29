# Nuxt setup

Target: any Nuxt 3 / 4 app in dev. The module is **dev-only** — `nuxt build` is
untouched. Nuxt's dev bundler is Vite, so `@pinagent/nuxt-plugin` is a thin
wrapper that reuses `@pinagent/vite-plugin` (source tagging, the `/__pinagent/*`
middleware, the WebSocket server) and injects the widget into Nuxt's
server-rendered HTML via the app head.

## 1. Install the module

```bash
cd /path/to/target/repo
pnpm add -D @pinagent/nuxt-plugin
```

If the consumer's `postinstall` hook is flaky and rolls back the install, pass
`--ignore-scripts` — no pinagent behavior depends on those scripts.

## 2. Add to `nuxt.config.ts`

```ts
export default defineNuxtConfig({
  modules: ['@pinagent/nuxt-plugin'],

  // optional — these are the defaults
  pinagent: {
    spawnAgent: 'inline', // 'inline' | 'worktree' | 'off'
    dock: false,
  },
});
```

That's it. The module handles:

- source tagging — Vue SFC `<template>` markup gets `data-pa-loc` +
  `data-pa-comp`, and any `.tsx`/`.jsx` is tagged too (via the reused Vite plugin)
- widget injection — added to the app head at body-close, since Vite's
  `transformIndexHtml` doesn't run for Nuxt's SSR'd document
- `/__pinagent/*` middleware + the WebSocket server (reused from the Vite plugin)

No layout/component changes needed.

## 3. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for the MCP server setup and `.gitignore` entry.
(Nuxt also generates `.nuxt/` and `.output/` — those are typically already in the
project's `.gitignore`.)

## Verify

```bash
cd /path/to/target && pnpm dev
# in another terminal — note: `nuxt dev` binds `localhost` (often IPv6 ::1),
# so use localhost rather than 127.0.0.1:
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/__pinagent/widget.js
# expect: 200
```

Then open the browser:

1. 💬 button bottom-right.
2. View source / inspect any element → the SSR'd DOM has
   `data-pa-loc="app.vue:11:3"` (and `data-pa-comp`).
3. Click 💬 → pick element → submit → a row lands in `<root>/.pinagent/db.sqlite`
   and the screenshot at `<root>/.pinagent/screenshots/<id>.png`.

## Configuration knobs

The `pinagent` key in `nuxt.config` accepts:

- **`spawnAgent`** — `'inline'` (default) runs a Claude Agent SDK query against
  the project root and streams events into the widget over WebSocket;
  `'worktree'` isolates each submit in a fresh git worktree on a `pinagent/<id>`
  branch; `'off'` (or `false`) records the comment only, so you drive the loop
  from your own agent session via `@pinagent/mcp`.
- **`dock`** — `false` by default. `true` mounts the project-management dock
  surface (Conversations, Changes/diffs, Branches, PRs, Connections, History)
  alongside the widget; the module serves the dock assets and injects the dock
  iframe + host bridge into the app head. The PR composer reads `GITHUB_TOKEN` /
  `PINAGENT_GITHUB_TOKEN`.

Override the permission mode with `PINAGENT_AGENT_PERMISSION_MODE` (default
`acceptEdits`). Override the WebSocket port with `PINAGENT_WS_PORT` (default
`53636`; the server walks forward to the next free port if it's taken).

Auth: by default uses the OAuth session from `claude login` (billed against your
subscription). Set `ANTHROPIC_API_KEY` to bill the API account instead, or
`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` for provider-backed auth.

Everything downstream of the source tag (widget, screenshot pipeline, agent
runtime, SQLite store, MCP) is identical across runtimes — only the build/dev
integration differs.

# Pinagent — Vue + Vite example

A minimal Vite + Vue 3 app wired up with `@pinagent/vite-plugin`. Click an element in the browser, leave a comment, and a coding agent picks it up with the file, line, and a screenshot.

This example is the smoke test for the Vue-on-Vite integration and the reference a new Vue (non-Nuxt) user copies from. The companion [React example](../react-vite/) and [SvelteKit example](../sveltekit-app/) demonstrate the same loop on other Vite frameworks; [Nuxt](../nuxt-app/) shows the Nuxt-module path for Vue.

## Run it

```sh
pnpm install                              # from the repo root
pnpm --filter vue-vite-example dev
```

The example's `predev` hook builds `@pinagent/vite-plugin` (and its upstream packages via turbo) before starting Vite, so the bundled plugin — including the inlined widget IIFE and the migrations copied from `@pinagent/db/drizzle/` — is what gets loaded. First start takes a couple of seconds; subsequent starts are turbo cache hits.

Open <http://localhost:5174>, click the Pinagent logo in the bottom-right, pick an element, leave a comment. The widget streams the agent's response back inline.

### If the dev server returns 500 on `/__pinagent/feedback`

That means `@pinagent/vite-plugin/dist/` is stale — typically after pulling a refactor that changed the agent runtime or the migrations layout. The `predev` hook should make this rare, but if it slips through, force a rebuild from the repo root:

```sh
pnpm build
```

then re-run `pnpm --filter vue-vite-example dev`.

## What it demonstrates

- One-line integration via `@pinagent/vite-plugin` — the same plugin that powers the React and SvelteKit examples tags `.vue` SFCs natively.
- Direct template elements (`<h1>`, `<p>`, `<footer>`) and component-rendered subtrees (`<Counter />`) both work — every `<template>` element is tagged with `data-pa-loc="<file>:<line>:<col>"` at transform time, and the widget reads that to anchor the comment. The fruit list rendered with `v-for` shows per-instance anchoring: each `<Counter>` points back at its own source line.

## The whole integration

Just two things, both in `vite.config.ts`:

```ts
import pinagent from '@pinagent/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  // pinagent() first — it runs enforce:'pre', so it tags raw .vue source
  // before @vitejs/plugin-vue compiles it.
  plugins: [pinagent(), vue()],
});
```

That's it. No component to mount, no route handler to define — the plugin injects the widget script and serves `/__pinagent/*` middleware automatically in dev. Production builds are untouched.

## Configure the agent loop

`pinagent()` accepts a `spawnAgent` option that controls what happens when a comment is submitted:

| Value | Behavior |
|---|---|
| `'inline'` (default) | Each submit runs a Claude Agent SDK query in the project root, streaming events into the widget over WebSocket. |
| `'worktree'` | Each submit spawns the agent in an isolated git worktree at `.pinagent/worktrees/<id>` on a `pinagent/<id>` branch. True parallel agents, no edit races. Review each branch like a PR. Requires a git repo. |
| `'off'` (or `false`) | No automatic spawn. Use this if you want to drive the loop from your own Claude Code session via the MCP server (`pnpm dlx @pinagent/cli mcp`, or `claude --dangerously-load-development-channels server:pinagent`). |

## Project layout

```
examples/vue-vite/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts    ← the integration
└── src/
    ├── main.ts        ← standard Vue entry
    ├── App.vue        ← demo content; nothing Pinagent-specific
    ├── Counter.vue    ← element to click on (rendered in a list)
    └── Logo.vue       ← the brand mark, drawn from @pinagent/ui tokens
```

Nothing in `src/` knows about Pinagent. The widget is delivered by the plugin alone.

## Caveats

- **Dev-only by design.** The transform, the widget injection, and the `/__pinagent/*` middleware are all gated on `command === 'serve'`. `vite build` produces an untouched production bundle.
- **Port 5174** is the dev server port (`strictPort: false`, so Vite picks the next free port if it's taken). React's example uses 5173.
- **Port 53636** (overridable via `PINAGENT_WS_PORT`) is bound by the WebSocket server when the dev server starts. Free that port or set the env var if you have a collision.
- **`.pinagent/`** under the project root is where feedback records, screenshots, and the SQLite mirror live. Already covered by the repo-root `.gitignore`.

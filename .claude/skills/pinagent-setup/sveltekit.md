# SvelteKit setup

Target: any SvelteKit app in dev. SvelteKit is **Vite-native**, so there's no
dedicated `@pinagent` package — you use `@pinagent/vite-plugin` (which tags
`.svelte` components, mounts the `/__pinagent/*` middleware, and starts the
WebSocket server) plus one small dev-only SvelteKit hook to inject the widget.
The plugin is no-op on `vite build`.

> Plain **Svelte + Vite** (no `@sveltejs/kit`) is simpler — it's an SPA with an
> `index.html`, so the widget auto-injects via `transformIndexHtml`. Use
> [vite.md](./vite.md) and skip the hook step below.

## 1. Install the plugin

```bash
cd /path/to/target/repo
pnpm add -D @pinagent/vite-plugin
```

(No native build step — the agent runner uses Node's built-in `node:sqlite`.)

## 2. Add to `vite.config.ts`

Put `pinagent()` **ahead of** `sveltekit()` — it runs `enforce: 'pre'`, so it
tags the raw `.svelte` source before SvelteKit/vite-plugin-svelte compiles it.

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import pinagent from '@pinagent/vite-plugin';

export default defineConfig({
  plugins: [pinagent(), sveltekit()],
});
```

## 3. Inject the widget — `src/hooks.server.ts`

SvelteKit renders its own document (`app.html`), so Vite's `transformIndexHtml`
(how the plugin injects the widget for SPAs) never fires. Use the
`transformPageChunk` hook, gated on `dev` so production is untouched:

```ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

const WIDGET = '<script src="/__pinagent/widget.js" type="module"></script>';

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: dev
      ? ({ html }) => html.replace('</body>', `${WIDGET}</body>`)
      : undefined,
  });
```

If you already have a `handle` (or use `sequence(...)` from
`@sveltejs/kit/hooks`), add the `transformPageChunk` to your existing resolve
call instead of replacing it.

## 4. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for the MCP server setup and `.gitignore` entry.
(SvelteKit also generates `.svelte-kit/` and `build/` — usually already ignored.)

## Verify

```bash
cd /path/to/target && pnpm dev
# vite dev binds localhost; the SvelteKit default port is 5173:
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:5173/__pinagent/widget.js
# expect: 200
```

Then open the browser:

1. 💬 button bottom-right.
2. View source / inspect any element → the SSR'd DOM has
   `data-pa-loc="src/routes/+page.svelte:10:1"` (and `data-pa-comp`, which for a
   route file shows as `+page` / `+layout` — the file *is* the component).
3. Click 💬 → pick element → submit → a row lands in `<root>/.pinagent/db.sqlite`
   and the screenshot at `<root>/.pinagent/screenshots/<id>.png`.

## Configuration knobs

`pinagent()` accepts the same options as in any Vite app — `spawnAgent`
(`'inline'` | `'worktree'` | `'off'`), `dock`, `root`. See the
[vite.md](./vite.md) "Configuration knobs" section; everything there applies
identically (only the widget-injection step differs for SvelteKit).

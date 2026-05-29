# sveltekit-app-example

A minimal [SvelteKit](https://svelte.dev/docs/kit) app wired to
[`@pinagent/vite-plugin`](../../packages/vite-plugin), exercising the full
click→agent loop in a SvelteKit dev server.

## Run it

```bash
pnpm --filter sveltekit-app-example dev
```

The `predev` hook builds `@pinagent/vite-plugin` first, then starts `vite dev`.
Open the page and the Pinagent widget loads — click any element, leave a comment,
and a Claude Agent SDK run picks it up and edits `src/routes/+page.svelte`.

### Drive it from your own agent session instead

```bash
pnpm --filter sveltekit-app-example dev:dogfood   # PINAGENT_SPAWN_AGENT=off
```

## How it's wired — SvelteKit needs no dedicated Pinagent package

SvelteKit is Vite-native (it already has a `vite.config.ts`), so the integration
is just the standard Vite plugin plus one small dev-only hook:

1. **`vite.config.ts`** — add `pinagent()` ahead of `sveltekit()`. Because it
   runs `enforce: 'pre'`, it tags the raw `.svelte` source before
   `vite-plugin-svelte` compiles it, and it mounts the `/__pinagent/*` middleware
   + WebSocket server on the same Vite dev server SvelteKit uses.

   ```ts
   import { sveltekit } from '@sveltejs/kit/vite';
   import pinagent from '@pinagent/vite-plugin';

   export default defineConfig({
     plugins: [pinagent(), sveltekit()],
   });
   ```

2. **`src/hooks.server.ts`** — inject the widget loader into the SSR'd HTML, dev
   only. SvelteKit renders its own document (`app.html`), so Vite's
   `transformIndexHtml` (how the plugin injects the widget for SPAs) never fires;
   `transformPageChunk` is the idiomatic seam:

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

That's it — the widget, `/__pinagent` middleware, WebSocket server, agent
runtime, SQLite store, and MCP server are all framework-agnostic and shared with
the Vite, Next.js, and Nuxt integrations. `vite build` is untouched (the plugin
is `apply: 'serve'`, and the widget injection is gated on `dev`).

> Note: `data-pa-comp` is derived from the filename, so for a SvelteKit route the
> enclosing-component name shows as `+page` / `+layout` (the file *is* the
> component). The `data-pa-loc` `file:line:col` is the precise anchor.

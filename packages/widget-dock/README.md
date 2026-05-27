# @pinagent/widget-dock

The Pinagent dock surface — a project-management UI that complements the per-element widget (`@pinagent/widget`). Where each widget owns *one conversation anchored to one DOM element*, the dock owns *everything else*: conversation lists, change review, PR composition, branch management, connections, settings, history.

## Opt-in by default

**This package does not auto-mount.** Pinagent's host integrations (`@pinagent/vite-plugin`, `@pinagent/next-plugin`) inject the per-element widget by default but never the dock. Project authors must explicitly opt in to ship the dock surface to their app.

The rationale:
- The per-element widget is universally useful — anyone using Pinagent benefits from click-to-comment.
- The dock is a power-user surface. Many projects don't need a project-management overlay sitting on every page; some teams will prefer to manage conversations from the hosted dashboard at `app.pinagent.io` and keep the host app uncluttered.
- Giving consumers explicit control over the second surface is friendlier than auto-mounting and asking them to dismiss.

The opt-in API will land alongside the embedded-iframe entry point (spec: `src/entry/embedded.tsx`) in a follow-up. Expected shape:

```ts
// vite.config.ts
import pinagent from '@pinagent/vite-plugin';

export default defineConfig({
  plugins: [
    pinagent({
      dock: true, // default: false
    }),
  ],
});
```

Until that lands, consumers who want to integrate the dock today do so by importing the React components directly (e.g., in a standalone admin route).

## What ships today

- **Visual + components layer** — design tokens, brand-tuned shadcn primitives, the FAB + 3 layout modes + chrome + nav rail, four state components, and three fixture-driven reference screens (Overview, Conversations, Changes). Five route placeholders for screens the visual language will be re-applied to in a follow-up.
- **No transport, no router, no real data.** This package's React tree currently renders fixtures from `src/fixtures/*.ts`. The `DockTransport` abstraction, TanStack Router/Query setup, and WebSocket subscription bridge from spec Phase 1 are deferred.
- **No embedded entry** — the two-entry-points split (embedded for iframe, standalone for hosted dashboard) from spec section 13 is also deferred. Today there's a single dev entry at `src/main.tsx`.

## Dev preview

```bash
pnpm --filter @pinagent/widget-dock dev
```

Opens [http://127.0.0.1:5174/](http://127.0.0.1:5174/) with both the dock and the per-element widget mounted on a sample host backdrop, so the full two-surface layout is reviewable in one place. The widget IIFE is bundled into this dev preview only — it is *not* a runtime dependency of the dock package.

- Click the bottom-left ink pin → opens the dock in panel mode. Drag to any corner; choice persists. Toggle Panel / Floating / Fullscreen from the chrome dropdown.
- Click the bottom-right picker pin, or press `c` anywhere outside an input → enter element-pick mode. Click any element on the page to open the per-element composer.
- Append `?state=disconnected` to see the dock's disconnected indicator.

## Build

```bash
pnpm --filter @pinagent/widget-dock build
```

Produces a standalone Vite build under `dist/`. Bundle size: ~346 kB JS / ~109 kB gz (within the 200 kB gz spec budget). Geist font subsets are split into per-script woff2s fetched on demand.

# @pinagent/widget-dock

The Pinagent dock surface — a project-management UI that complements the per-element widget (`@pinagent/widget`). Where each widget owns *one conversation anchored to one DOM element*, the dock owns *everything else*: conversation lists, change review, PR composition, branch management, connections, settings, history.

## Opt-in by default

**This package does not auto-mount.** Pinagent's host integrations (`@pinagent/vite-plugin`, `@pinagent/next-plugin`) inject the per-element widget by default but never the dock. Project authors must explicitly opt in to ship the dock surface to their app.

The rationale:
- The per-element widget is universally useful — anyone using Pinagent benefits from click-to-comment.
- The dock is a power-user surface. Many projects don't need a project-management overlay sitting on every page; some teams will prefer to manage conversations from the hosted dashboard at `app.pinagent.io` and keep the host app uncluttered.
- Giving consumers explicit control over the second surface is friendlier than auto-mounting and asking them to dismiss.

Opt in via the Vite plugin:

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

The Next.js plugin (`@pinagent/next-plugin`) accepts the same `dock: true` option.

## What ships today

- **Visual + components layer** — design tokens, brand-tuned shadcn primitives, the FAB + 3 layout modes + chrome + nav rail, four state components.
- **All eight Phase 1 routes** ship as read-only screens: Overview, Conversations, Changes, Branches, PRs, Connections, Settings, History. Other write actions are deferred per spec: Changes batch → Phase 3 (PR composer), Branches prune → Phase 4, Connections / Settings writes → Phase 5, History full-text + audit log → Phase 6. Disabled controls preview the eventual capability in-place so the surface is visually complete.
- **Phase 2 — conversation write ops** ship in Conversations: per-conversation Land / Discard with optimistic intent + 10s timeout rollback + Retry; inline `ask_user` reply form (textarea or option chips, correlated by `askId`); optimistic message append so user replies and ask answers appear in-flow instantly; a horizontal status timeline (Submitted → Working → Awaiting → Ready → Resolved) below the detail header.
- **Transport + live data** — `DockTransport` abstraction with `LocalTransport` (HTTP to dev-server + WS subscriptions) and `MockTransport` (fixtures, `?fixtures=on`). Overview / Conversations / Changes pull from real conversation data and update in real time. Branches / PRs / Connections / Settings render from fixtures pending their server-side read endpoints; History reuses the conversations cache + a client-side resolved-status filter.
- **No router yet.** Routing is `useState<RouteKey>` in `App.tsx`. TanStack Router lands when the embedded vs standalone entry split (spec §13) does.
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

Produces a standalone Vite build under `dist/`. Bundle size: ~434 kB JS / ~132 kB gz (within the 200 kB gz spec budget). Geist font subsets are split into per-script woff2s fetched on demand.

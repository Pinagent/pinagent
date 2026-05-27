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

## Routes

The dock is a single-page app with eight top-level routes. Each lives in `src/routes/<Name>.tsx`; the router tree is declared in `src/router.tsx`.

| Path             | Screen        | What it does                                                                                       |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `/`              | Overview      | At-a-glance summary: active conversations, recent activity, project health.                        |
| `/conversations` | Conversations | List + detail of every conversation. Reply, land/discard, rename, archive.                         |
| `/changes`       | Changes       | Ready-to-land worktrees with expandable inline diffs. Multi-select → PR composer.                  |
| `/branches`      | Branches      | Active worktrees with git cleanliness + disk usage. Per-row and bulk prune.                        |
| `/prs`           | PRs           | GitHub PRs the dock's compose flow opened.                                                         |
| `/connections`   | Connections   | Set / replace / clear the GitHub PAT and Anthropic API key (validated upstream before persisting). |
| `/settings`      | Settings      | Base branch, worktree retention, per-conversation cap, monthly budget, permission mode.            |
| `/history`       | History       | Full-text search across resolved conversations (comment, note, branch, anchor file, selector).     |

Route components are code-split via `React.lazy` — every screen except Overview loads on demand, with a shared Suspense fallback inside the dock shell.

## Keyboard shortcuts

Global shortcuts are wired in `src/shell/useKeyboardShortcuts.ts`; the pure matching logic lives in `src/shell/shortcut-match.ts` (testable without React).

| Keys                          | Action                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `Cmd/Ctrl + Shift + P`        | Toggle the dock open/closed. Wins even while typing — matches command-palette muscle memory.       |
| `g` then `c`                  | Go to Conversations.                                                                               |
| `g` then `h`                  | Go to History.                                                                                     |
| `g` then `s`                  | Go to Settings.                                                                                    |
| `/`                           | Focus the active route's search input (when one is mounted and the dock is open).                  |
| `c`                           | Enter element-pick mode for the per-element widget. (Lives on the host page, not in the dock.)     |

The `g`-chord window is 1.5s. Any unmatched key during the window cancels the chord. Shortcuts ignore keypresses inside `<input>`, `<textarea>`, `<select>`, and `contenteditable` regions — `Cmd/Ctrl + Shift + P` is the only one that bypasses that gate.

When the dock is loaded inside an iframe (embedded mode), the host page bridges its keydown events into the iframe via `postMessage` so shortcuts work even when focus is outside the dock.

## Deep links

The Conversations route accepts a `?id=<conversation-id>` search param that opens the detail view inline:

```
/conversations?id=fb_abc123
```

Empty / absent `id` → list view. The router shares state (filters, query, scroll) across list ↔ detail so backing out of detail restores the list as it was. Validation lives in `src/routes/conversations-search.ts`; malformed values silently collapse to `{}`.

Deep links only behave like real URLs in the **standalone** entry point — embedded mode uses memory history (see *Entry points* below), so the URL bar of the host page doesn't move. The host can still drive iframe navigation programmatically; cross-frame URL sync is a future extension.

## Rename + archive

Both live on the conversation detail view in `/conversations?id=<id>`.

- **Rename** — click the conversation title to inline-edit. `Enter` commits, `Escape` cancels, blur also commits. Empty / whitespace-only title clears back to the comment-derived default (so users can revert without remembering the original).
- **Archive / unarchive** — toolbar button on the detail header. Archived conversations hide from the default list; toggle the "Archived" filter chip in the list header to reveal them. The History route always includes archived rows.

Both call one transport method:

```ts
transport.updateConversation(id, { title?: string | null; archived?: boolean });
```

The server (`PATCH /__pinagent/feedback/:id`) caps title at 200 chars, collapses empty strings to NULL, and emits diff-aware audit events (`conversation_renamed`, `conversation_archived`, `conversation_unarchived`) — only when the field actually changed. The optimistic mutation hook lives at `src/hooks/useUpdateConversation.ts`.

## Transports

The whole React tree reads from one `DockTransport` instance via `useTransport()`; the boundary lives in `src/transport/`. The interface is intentionally narrow — every dock view talks through these methods, never `fetch` or `new WebSocket()` directly.

Today there are two implementations:

- **`LocalTransport`** — production-shaped. Same-origin HTTP to `/__pinagent/*` endpoints (proxied through Vite in dev, served by the host plugin in production) plus a direct WebSocket to the WS server port (`53636` by default; see `src/lib/ws-url.ts`). Used by both the embedded iframe and the standalone build until the hosted relay exists.
- **`MockTransport`** — fixtures from `src/fixtures/` with in-memory mutation. Enabled by `?fixtures=on` (also accepts `true` / `1`) on either entry. Useful for design review, screenshots, and the dev preview without a host backend.

Two more transports are on the roadmap and will implement the same interface so the React tree never changes:
- **`EmbeddedTransport`** — `postMessage` to a host script, for cross-origin sandboxing.
- **`StandaloneTransport`** — direct calls into the hosted relay, for the `app.pinagent.io` dashboard.

`DockTransport.kind` (`'local' | 'mock'`) lets debug overlays distinguish implementations; consumers branch on shape, not name.

## Entry points

Three HTML entries share one Vite config:

| Entry             | Purpose                                                                                                                              | History          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `index.html`      | Dev preview (`vite dev`). Mounts the dock + the per-element widget on a sample host backdrop. **Not** in the production build.       | Browser          |
| `embedded.html`   | Production iframe build. Loaded into host pages by `@pinagent/vite-plugin` and `@pinagent/next-plugin` when `dock: true` is passed.  | Memory           |
| `standalone.html` | Production hosted-dashboard build. Will ship from `app.pinagent.io/projects/:id/dock/...` once the hosted relay lands.                | Browser          |

`rollupOptions.input` in `vite.config.ts` only lists the two production entries, so the dev preview never ships to consumers. Memory vs browser history is the main split:

- The embedded iframe's URL bar isn't user-visible, so memory history keeps navigation in-process. Host → iframe navigation will eventually flow over `postMessage`.
- The standalone build is a real SPA — deep links and back/forward work. The hosted dashboard's framework is expected to serve the bundle on any sub-path (SPA fallback) so client routing wins.

## Dev preview

```bash
pnpm --filter @pinagent/widget-dock dev
```

Opens [http://127.0.0.1:5174/](http://127.0.0.1:5174/) with the dock + the per-element widget mounted on a sample host backdrop, so the full two-surface layout is reviewable in one place. The widget IIFE is bundled into this dev preview only — it is *not* a runtime dependency of the dock package.

- Click the bottom-left ink pin → opens the dock in panel mode. Drag to any corner; choice persists. Toggle Panel / Floating / Fullscreen from the chrome dropdown.
- Click the bottom-right picker pin, or press `c` anywhere outside an input → enter element-pick mode. Click any element on the page to open the per-element composer.
- `?fixtures=on` swaps `LocalTransport` for `MockTransport` (fixtures + in-memory mutation).
- `?state=disconnected` forces the dock's disconnected indicator.

The dev preview proxies `/__pinagent/*` to `http://127.0.0.1:5173` by default (the typical Vite host port). Override via `PINAGENT_HOST_ORIGIN` to point at a different host.

## Build

```bash
pnpm --filter @pinagent/widget-dock build
```

Produces a Vite multi-page build under `dist/` containing `embedded.html` and `standalone.html` plus per-route code-split chunks. Geist font subsets are split into per-script woff2s fetched on demand.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# In-dock worktree switcher — app-preview overlay

> Status: **design** (not yet implemented). Builds on the worktree
> dev-server launcher (PR #203) and its docs follow-up (#205).

In `spawnAgent: 'worktree'` mode each agent's work lives on its own branch
in `.pinagent/worktrees/<id>`. PR #203 added an **Open app** action that
stands up an on-demand dev server rooted at a worktree and opens it in a
new browser tab. This design takes the next step: let the developer
**switch which worktree's running app they're looking at from inside the
dock**, without juggling browser tabs.

## What "switch" means here

We deliberately scope this to an **app-preview overlay**, not a full
transport retarget:

- The dock stays connected to the **main** dev server — it remains the
  single source of truth for conversations, branches, changes, PRs, etc.
- Switching worktrees swaps the `src` of an **app-preview iframe** that
  points at the chosen worktree's dev server. The dock's transport
  (`LocalTransport` origin + `resolveWsUrl()`) never changes.

```
┌─ dock (persistent control surface, served from main origin) ─────────┐
│  Preview ▾   [main]  [wt-A]  [wt-B]*                                  │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │                                                                    ││
│ │   <iframe src="http://localhost:53701?pinagent_dock=off">          ││
│ │     worktree B's running app                                       ││
│ │                                                                    ││
│ └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
        switch(wt-B):  iframe.src = serverFor(wt-B).url
        switch(main):  hide overlay → host app shows through
```

### Why not retarget the whole dock

The full-retarget variant (point the dock's HTTP origin + WS at the
worktree's server, reconnect, reset the query cache, navigate the host
app) is the literal reading of "swap the entire UI," and it is *feasible*
— notably, a launched worktree server inherits `PINAGENT_PROJECT_ROOT`
from the main dev process, so it reads/writes the **same `.pinagent`
SQLite DB** and would show consistent data. But it is the riskiest piece
on the board:

- `LocalTransport` resolves its `origin` and `resolveWsUrl()` **once at
  construction** (`packages/widget-dock/src/transport/local.ts:306-318`).
  Making it re-targetable at runtime — tear down the `DockWsClient`,
  rebuild it, and invalidate every TanStack Query — is a real refactor
  that touches every view.
- Multiple dev servers writing one SQLite file raises concurrency
  questions we don't otherwise have.

The overlay gets the user's actual goal ("see/interact with worktree B's
running app") at a fraction of the cost and risk, and leaves the
retarget refactor as a clearly-scoped future option if we ever want true
side-by-side *control surfaces* (not just app views).

## Architecture

Three pieces: a server-side registry endpoint, a dock preview surface,
and a nested-dock suppression hook.

### 1. Expose the running-server registry (server)

The launcher already keeps a `globalThis`-pinned registry of one dev
server per worktree in `packages/agent-runner/src/worktree-serve.ts`
(`serveWorktree` / `stopWorktreeServer`). It just isn't readable yet.

Add:

- `listWorktreeServers(): { feedbackId, port, url, status }[]` in
  `worktree-serve.ts`, reading the existing registry (status: `starting`
  | `running` | `exited`).
- Route `GET /__pinagent/worktree-servers` (vite middleware +
  next route), mirroring the existing `/__pinagent/branches` handlers.
- Route `DELETE /__pinagent/worktree-servers/:id` → `stopWorktreeServer`,
  so the switcher can reclaim a port without pruning the whole worktree.

`serveBranch` (PR #203, `POST /__pinagent/branches/:id/serve`) already
covers *start*; the switcher reuses it verbatim.

**Live updates (Phase 2):** emit a `worktree_servers_changed` project
event when a server starts/exits and fan it out through the existing
`subscribe_project` → `project_event` channel
(`packages/agent-runner/src/ws-server.ts:331`). Phase 1 can simply poll
`GET /__pinagent/worktree-servers` on an interval via TanStack Query.

### 2. Dock preview surface + switcher (widget-dock)

- **Transport**: add `listWorktreeServers()` and `stopWorktreeServer()`
  to `DockTransport` (`transport/types.ts`), implemented in `local.ts`
  (HTTP) and `mock.ts` (fixtures). `serveBranch()` already exists.
- **Hook**: `useWorktreeServers()` (query) +
  `useStopWorktreeServer()` (mutation), alongside the existing
  `useServeBranch()` in `hooks/useBranches.ts`.
- **State**: a small `activeWorktree` value (`'main' | <feedbackId>`)
  held in a dock-level context or the router search params. `'main'` is
  the default and means "overlay hidden."
- **UI**:
  - A **switcher** control — a segmented control / dropdown listing
    `main` plus every worktree with a linked conversation, badged with
    its server status (running ● / stopped ○). Lives in the dock chrome
    (`shell/DockChrome.tsx`) so it's reachable from any panel, or as a
    header control on the Branches panel for a smaller first cut.
  - A **`WorktreePreview`** surface — a dock panel rendering
    `<iframe src={serverUrl}>`. Because it must be *interactive* (not
    click-through), it is an ordinary dock panel: the existing
    layout-broadcaster (`entry/layout-broadcaster.ts`) already reports
    panel rects to the host bridge so the host page toggles the iframe's
    `pointer-events` over those rects
    (`packages/vite-plugin/src/index.ts` `DOCK_HOST_BRIDGE_TAG`).

**Switch flow** (`onSelect(target)`):

1. `target === 'main'` → hide the preview surface; the host app shows
   through the (click-through) dock again.
2. `target === <id>` → find it in `useWorktreeServers()`. If running,
   set `iframe.src`. If not, call `serveBranch(id)` (show a spinner;
   readiness is awaited server-side), then set `iframe.src` to the
   returned URL. Mark `id` active.

### 3. Nested-dock suppression (plugins)

The worktree's dev server runs the **same** pinagent plugin, so if the
project uses `dock: true`, worktree B's app would inject *its own* dock
iframe — a dock inside the preview inside the dock. We suppress the inner
one:

- The preview iframe loads the worktree URL with a marker
  (`?pinagent_dock=off`, or a `postMessage` after load).
- The dock-iframe injection scripts honor it before appending the iframe:
  `DOCK_IFRAME_TAG` in `packages/vite-plugin/src/index.ts` and the
  `<Pinagent />` mount in `packages/next-plugin/src/component.tsx`.

The per-element **widget** inside the preview is *kept* — clicking an
element there should still capture feedback. Because the worktree server
shares the main `.pinagent` DB (inherited `PINAGENT_PROJECT_ROOT`), that
feedback lands in the same place the dock is already reading, so a new
comment from the preview shows up in the dock's Conversations list with
no extra plumbing.

## Data flow

```
dock (main origin :5173)                 worktree server (:53701, shares main .pinagent DB)
─────────────────────────                ──────────────────────────────────────────────────
GET /__pinagent/worktree-servers ──────▶ registry: [{id, port, url, status}]
  (or POST /branches/:id/serve to start)
        │
        ▼
WorktreePreview <iframe src=…?pinagent_dock=off>
        │  (cross-origin; dock only sets .src)
        ▼
worktree app renders + injects its own widget → WS :53711 → shared DB
        │
new feedback ─────────────────────────────────────────────▶ main dock's Conversations
                                                              (already polling/subscribed)
```

## Edge cases & decisions

- **Cross-origin iframe.** The preview is a *different origin* from the
  dock (`:53701` vs `:5173`), so the dock can only set `src` — no reaching
  into the document. That's sufficient; the worktree app's own widget
  handles its own WS. No `postMessage` bridge needed for the MVP.
- **pointer-events.** The preview must be a real (non-click-through) dock
  panel so the layout-broadcaster grants it interaction; otherwise clicks
  fall through to the host app underneath.
- **Host consistency.** `serveWorktree` returns `http://localhost:<port>`;
  keep the host (`localhost` vs `127.0.0.1`) consistent with how the dock
  iframe is addressed to avoid surprise cross-origin mismatches.
- **Server died.** If a tracked server has `status: 'exited'`, the
  switcher offers "restart" (re-`serveBranch`) instead of pointing the
  iframe at a dead port.
- **Stop vs prune.** Stopping a server (DELETE worktree-servers/:id)
  frees the port but keeps the worktree; pruning (existing) tears down the
  worktree and — already wired in #203 — stops its server first.

## Phasing

- **Phase 1 (MVP).** `GET /__pinagent/worktree-servers` (polled),
  switcher (main + running/startable worktrees), `WorktreePreview`
  iframe, start-on-select via `serveBranch`, nested-dock suppression.
- **Phase 2.** `worktree_servers_changed` project event for live
  switcher updates; `DELETE` stop action; a running ● indicator + "Open
  in dock" affordance on Branches rows; remember last-selected worktree.
- **Phase 3 (optional).** Side-by-side compare — two `WorktreePreview`
  panes (e.g. main vs worktree, or two worktrees) reusing the same
  component; pure UI work, transport untouched.

## Files this will touch

| Area | Files |
| --- | --- |
| agent-runner | `worktree-serve.ts` (+`listWorktreeServers`), `index.ts` (exports), optional `ws-server.ts`/project-events for Phase 2 |
| vite-plugin | `middleware.ts` (GET/DELETE routes), `index.ts` (`DOCK_IFRAME_TAG` suppression) |
| next-plugin | `route.ts` (GET/DELETE routes), `component.tsx` (suppression) |
| widget-dock | `transport/{types,local,mock}.ts`, `hooks/useBranches.ts`, new `shell/WorktreePreview.tsx` + switcher in `shell/DockChrome.tsx`, `activeWorktree` state |

## Non-goals

- Re-pointing the dock's own transport/WS at a worktree (the full
  retarget). Explicitly out of scope; revisit only if cross-worktree
  *control surfaces* (not just app views) are ever needed.
- Production/hosted use. This is a localhost dev affordance, same as the
  launcher it builds on.

# @pinagent/widget

Browser UI for Pinagent — the per-element widget. Renders a fixed FAB inside a closed shadow root, lets the user pick any DOM element, captures a page screenshot, and submits a comment. Once submitted, each pinned element grows its own composer iframe that streams the agent's progress back from the WebSocket.

Complements `@pinagent/widget-dock`: where the dock owns the project-management surface (lists, PR composer, branches, settings), this widget owns *one conversation per pinned element*.

**You should not install this package directly.** It's built as an IIFE and served by the host plugins (`@pinagent/vite-plugin`, `@pinagent/next-plugin`) at `/__pinagent/widget.js`. Adopters opt the widget in by adding the plugin; configuration lives there.

## Shadow-root contract

Everything UI ships under a single closed shadow root (`mode: 'closed'`):

- The FAB, picker overlay, and per-element composer iframes mount into descendants of the shadow root.
- Closed mode means host page styles can't bleed in and host JS can't reach in via `host.shadowRoot`.
- The composer is an `iframe` because closed shadow can still be pierced by some browser devtools / extensions, and the agent transcript needs strong isolation from host CSS.
- One mount per page: `window.__pinagentMounted` short-circuits duplicate IIFE loads (dev preview + host plugin both attempting to inject is the common case).

## Picker hotkey

Press `c` outside any text input to enter element-pick mode. Click any element on the page to open the composer pinned to it. The hotkey is configurable via a global:

```js
window.__pinagentHotkey = 'p';      // pick mode key
window.__pinagentHotkey = false;    // disable entirely
```

`shouldIgnoreHotkey` skips the trigger when the keypress is inside `<input>`, `<textarea>`, `<select>`, a `contenteditable` region, or carries a modifier (`Cmd` / `Ctrl` / `Alt`).

A second shortcut, **`Shift + N`**, hops between active in-flight composers — useful when several agents are running concurrently and you want to flip through their streams without clicking each one. The chord is deliberate: bare `n` collides with typing; `Cmd/Ctrl + N` is the browser's "new window".

## Anchoring + re-anchoring

When the user picks an element, the widget records:

- `data-pa-loc` — `file:line:col` injected by `@pinagent/babel-plugin` at build time. Preferred anchor because it survives DOM restructuring as long as the source line doesn't move.
- A short CSS selector — fallback when `data-pa-loc` isn't present (e.g. third-party markup, or apps not running the babel plugin).
- Cursor position relative to the element + viewport size, so the composer chrome stays close to the click point across scrolls and layout shifts.

`findReanchorTarget` looks up the live element on reload / HMR. The babel-injected attribute is unique-when-possible but can be ambiguous if the same JSX renders in a loop; the selector fallback breaks ties.

All anchor metadata persists in the `widget_anchors` table (`@pinagent/db`). The browser cache rebuilds itself from the server if it ever diverges.

## Screenshot capture

`screenshot.ts` uses `html-to-image` to snapshot the visible viewport when the user submits a comment. The data URL is sent inline with `POST /__pinagent/feedback`, so the screenshot is the same bytes the dock and agent see. No headless browser, no extension.

Caveats:
- Cross-origin images render as blanks (browser security).
- Canvas elements with `preserveDrawingBuffer: false` render blank.
- The agent gets the screenshot via `mcp__pinagent__get_feedback`, not via DOM access — so a missing capture degrades gracefully.

## Local cache

The widget keeps a per-page mirror of conversation state in SQLite-WASM via `@pinagent/browser-runtime`'s worker. `src/db/` has the typed client:

- `reads.ts` — `listPendingForCurrentPage`, `getConversationMessages`
- `writes.ts` — `recordConversationStart`, `recordEvent`, `recordUserMessage`, `markConversationResolved`, `deleteConversation`

The schema lives in `@pinagent/db` and is shared with the server's `better-sqlite3` instance. The cache is rebuildable: a divergence from the server triggers a wipe + rehydrate, never a manual reconcile.

### `:memory:` fallback (no persistence)

The worker prefers the persistent OPFS **SAH Pool VFS** and silently falls back to an in-memory (`:memory:`) database when it can't install — most often because **a second tab of the same app already holds the storage lock** (only one worker can own the SAH handles), and otherwise in contexts without OPFS SAH (older Safari, some private windows). In that tab the cache works but is lost on reload.

The worker reports which backend it landed on in its `init` ACK (`{ ok: true, backend: 'opfs' | 'memory' }`; a missing field is treated as `'opfs'` for backward compatibility). The widget surfaces a degraded tab quietly — an amber dot + title hint on the FAB, plus a one-time dismissible note in the composer footer — without blocking anything. Cross-tab lock handoff is intentionally out of scope; the mirror is rebuildable from the server.

For the full offline-first host-integration contract, see [`docs/architecture/offline-first.md`](../../docs/architecture/offline-first.md).

## Build

```bash
pnpm --filter @pinagent/widget build
```

`tsdown` produces:

- `dist/widget.iife.js` — single IIFE, no external deps. Served by host plugins at `/__pinagent/widget.js`.
- `dist/brand.*` and `dist/logo.*` — small ESM/CJS exports for downstream packages that want the brand palette or the inline logo SVG (the dock uses these in its FAB).

Subpath exports declared in `package.json`:

```ts
import widgetIifeUrl from '@pinagent/widget/iife?url';  // URL to the IIFE
import { BRAND_INK } from '@pinagent/widget/brand';
import { Logo } from '@pinagent/widget/logo';
```

## Storybook

The widget is vanilla shadow-root DOM (no React framework), so Storybook runs
on the **HTML** renderer (`@storybook/html-vite`). Stories import the real
shipped source (`composerHTML`, `STYLES`, the controllers) — never copies — so
what you design is what ships in the embedded IIFE.

```bash
pnpm --filter @pinagent/widget storybook          # dev server on :6007
pnpm --filter @pinagent/widget build-storybook    # static build (also a CI gate)
```

- **Stories live in `src/stories/`** and are excluded from the IIFE entry
  (`src/index.ts` never imports them) — so they never reach the shipped bytes
  and don't trip the widget-cascade check.
- **`story-mount.ts`** mirrors `mount()`'s shadow-root + composer-iframe
  scaffolding for presentational stories; visual states are driven by the same
  CSS-only knobs the runtime uses (`body.mini`, `body[data-agent-state]`,
  `body.needs-input`).
- **`live-widget.ts`** (`Widget/Live`) wires the real controllers exactly as
  `mount()` does, against an inert `WidgetWsClient(null)` and a faked
  `/__pinagent` API — so picking, the composer, FAB drag/snap, and the
  running-agents tray are fully interactive offline.
- `build-storybook` is a turbo task gated in CI, so a broken story fails the PR.

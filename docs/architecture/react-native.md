# Pinagent for React Native (design)

Status: **implemented (server proven) + native client ready to wire**.
This document maps the existing web architecture onto React Native and
explains what is reused verbatim, what is adapted, and what has to be
rebuilt. The implementation lives in
[`packages/react-native/`](../../packages/react-native): the dev-server
middleware is built, typechecked, and covered by an integration test; the
native widget ships as source (see
[How the package is split](#how-the-package-is-split)). A runnable Expo
example is in
[`packages/react-native/example/`](../../packages/react-native/example).

## TL;DR

The click-to-comment loop is **two layers**: a runtime-agnostic Node
backend (storage + agents + MCP) and a browser-only widget. The backend
ports almost verbatim. The widget is a full rewrite — but React Native
already ships the single hardest piece, **tap-a-view → source location**,
in its own dev Inspector, so the rewrite is smaller than it looks.

| Concern | Web (today) | React Native | Verdict |
| --- | --- | --- | --- |
| Source tagging (`file:line:col`) | `@pinagent/babel-plugin` injects `data-pa-loc` | `@pinagent/react-native/babel` injects the same `data-pa-loc` prop | **Build-time plugin** — React 19 removed `_debugSource`, so RN's old dev source is gone (see note) |
| Element under pointer → source | DOM walk for `data-pa-loc` + CSS-selector fallback | `getInspectorDataForViewAtPoint` → host fiber's `data-pa-loc` prop | **Rebuild** (thin wrapper over RN internals) |
| Picker overlay / highlight | closed shadow DOM + `getBoundingClientRect` | top-level `<View>` overlay + `measureInWindow` | **Rebuild** |
| Comment composer | focused `<iframe>` (escapes focus traps) | RN `<Modal>` / overlay `<View>` | **Rebuild** (simpler — no focus-trap problem) |
| Screenshot | `html-to-image` | `react-native-view-shot` (`captureScreen`) | **Rebuild** (swap the library) |
| Widget injection | `<script src="/__pinagent/widget.js">` (Vite html / Next `<Pinagent/>`) | `<Pinagent/>` component mounted at app root | **Reuse the Next.js model** |
| Feedback transport | `POST /__pinagent/feedback` to Vite/Next middleware | same POST to **Metro** dev-server middleware | **Reuse the contract, re-mount the route** |
| Persistence | `.pinagent/db.sqlite` via `@pinagent/db` + `Storage` | identical | **Reuse verbatim** |
| Agent runs | `@pinagent/agent-runner` (`spawnAgent`, worktrees, WS) | identical | **Reuse verbatim** |
| Agent pickup (pull mode) | `@pinagent/mcp` over stdio | identical | **Reuse verbatim** |

## The two layers

```
                    ┌─────────────────────────── REUSED VERBATIM ──────────────────────────┐
  tap a view        │                                                                       │
  + comment   ──▶  POST /__pinagent/feedback  ──▶  Storage.create  ──▶  .pinagent/db.sqlite │
   (NEW: RN          (REUSE contract,              (@pinagent/db)         + screenshots/     │
    widget)           re-mount on Metro)                  │                                  │
                                                          ▼                                  │
                                                    spawnAgent (inline / worktree)           │
                                                    @pinagent/agent-runner ──▶ WS stream     │
                                                          │                                  │
                                                    @pinagent/mcp (Claude Code pull mode)    │
                    └───────────────────────────────────────────────────────────────────────┘
```

Everything to the right of the POST is front-end-agnostic Node and does
not change. The work is (1) a new RN widget and (2) re-mounting the one
HTTP route on Metro.

## What gets reused verbatim

- **`@pinagent/db`** — the Drizzle schema (`conversations`, `messages`,
  `widget_anchors`, `active_runs`, …) is unaware of the front end.
- **`@pinagent/agent-runner`** — `Storage`, `spawnAgent`, the worktree
  lifecycle, the WS event bus, PR composition. All keyed on a project
  `root` directory, not on a browser.
- **`@pinagent/mcp`** — the stdio MCP server reads the same
  `.pinagent/db.sqlite`. A Claude Code session pulls feedback the same
  way regardless of whether it was filed from a browser or a phone.

The wire contract is already defined by
`FeedbackInputSchema` (`packages/agent-runner/src/storage.ts`):

```ts
{
  comment: string,                 // 1..8000 chars
  loc: { file, line, col } | null, // from the source tag
  selector: string,                // fallback id; see note below
  url: string,                     // RN: the route / screen name
  viewport: { w, h },              // RN: window dims from useWindowDimensions
  userAgent: string,               // RN: `${Platform.OS} ${Platform.Version}`
  screenshot: string,              // base64 PNG
  createdAt: string,               // ISO
  additionalAnchors?: [...]        // multi-pick; optional, can stay empty for v1
}
```

The RN widget only has to produce this shape. No backend change is
required to accept a phone-filed comment.

## What gets adapted: the Metro middleware

The Vite plugin mounts the feedback route in `transformIndexHtml` +
`configureServer`; Next mounts it as a route handler. Metro exposes the
same connect-style hook via `metro.config.js`:

```js
// metro.config.js
const { pinagentMiddleware } = require('@pinagent/react-native/server');

module.exports = {
  server: {
    enhanceMiddleware: (middleware, server) =>
      pinagentMiddleware({ projectRoot: __dirname }).chain(middleware),
  },
};
```

The adapter is a near-copy of the `POST /__pinagent/feedback` arm of
`packages/vite-plugin/src/middleware.ts` — parse with
`FeedbackInputSchema`, reject screenshots > 5 MB, `storage.create(id, input)`,
then `spawnAgent({ projectRoot, feedback, mode })`. It's implemented in
[`src/server/metro-middleware.ts`](../../packages/react-native/src/server/metro-middleware.ts)
and proven by
[`tests/metro-middleware.test.ts`](../../packages/react-native/tests/metro-middleware.test.ts),
which POSTs a feedback payload through the middleware and asserts a
conversation row lands in `.pinagent/db.sqlite` — the same backend the
web plugins use.

Two RN-specific wrinkles:

1. **No `localhost` from a device.** A real iOS/Android device reaches
   Metro at the LAN host Metro is already serving from. The widget reads
   that host from `NativeModules.SourceCode.scriptURL` (the bundle URL),
   so the POST target is derived, not hard-coded. The simulator/emulator
   cases (`localhost` / `10.0.2.2`) fall out of the same parse.
2. **WebSocket streaming is optional for v1.** Pull mode (MCP / a Claude
   Code session) needs no socket at all. Live agent streaming into the
   widget can come later by pointing the RN client at the same
   `ws-server.ts` the web widget uses.

## What gets rebuilt: the widget

This is the only genuinely new code. Three pieces:

### 1. Picking — `getInspectorDataForViewAtPoint`

RN's built-in dev Inspector (Dev Menu → "Show Inspector") already does the
hit-test half of pinagent's DOM walk: you tap, it finds the host view under
the touch and its component hierarchy. It's powered by
`getInspectorDataForViewAtPoint(inspectedView, x, y, callback)`, which
returns the touched view's `props` + the owner `hierarchy` (component
names).

For the source location pinagent originally rode RN's `_debugSource`,
populated by the dev `@babel/plugin-transform-react-jsx-source` transform —
"reuse RN's, no custom plugin needed". **That bet broke with React 19**: the
`ReactElement` constructor dropped its `source` argument and `_debugSource`
is gone (the `__source` prop is consumed by `jsxDEV` and never reaches
`memoizedProps`); RN 0.81+ also dropped the `source` field from the
inspector payload. So the runtime no longer carries any source location.

Instead we tag at build time, exactly like web: `@pinagent/react-native/babel`
(a Metro Babel plugin, `src/babel.ts`) splices a `data-pa-loc="file:line:col"`
prop onto every authored JSX element. That prop survives onto the host
fiber's `memoizedProps`, which `getInspectorDataForViewAtPoint` returns as
`data.props` — so `data-pa-loc` (web DOM attribute) ↔ `data-pa-loc` (RN prop),
the *same* attribute name and value format on both sides.
[`src/native/inspector.ts`](../../packages/react-native/src/native/inspector.ts)
reads it off the tapped view (then walks the owner hierarchy), and keeps the
legacy `_debugSource` / inspector-`source` reads as a fallback for older
RN/React. The inspector module path also moved in RN 0.81
(`Libraries/Inspector/…` → `src/private/devsupport/devmenu/elementinspector/…`),
which `loadInspector()` tries newest-first.

### 2. Overlay + highlight

A dev-only top-level `<View>` (`pointerEvents` toggled) captures the tap
coordinates. On a hit we `measureInWindow` the target to draw the
highlight rectangle — the RN analog of `getBoundingClientRect`. No shadow
DOM is needed because RN already isolates the component tree; and no
iframe is needed because RN has no host focus-trap problem to escape.

### 3. Screenshot

`react-native-view-shot`'s `captureScreen({ format: 'png', result: 'base64' })`
replaces `html-to-image`. Same downstream contract: base64 PNG in the
POST body, capped at 5 MB by the middleware.

## Injection model: copy Next, not Vite

The Vite integration injects a `<script>` tag, which has no RN analog.
The **Next.js** integration is the right template: a `<Pinagent/>`
client component mounted once at the app root, gated on `__DEV__`, that
renders `null` in production. RN consumers add exactly one line to their
root component. See
[`src/native/Pinagent.tsx`](../../packages/react-native/src/native/Pinagent.tsx).

## Deliberate cuts for v1 (and why they're safe)

- **No CSS-selector re-anchoring.** On web, `widget_anchors.selector`
  lets the widget re-find an element after HMR. RN has no selectors;
  v1 anchors on `file:line:col` only and sends a synthetic `selector`
  string (e.g. the component display-name chain) purely to satisfy the
  schema's `selector` field. Re-anchoring a live pin across Fast Refresh
  is a follow-up, not a blocker for filing comments.
- **No live WS streaming into the widget.** Pull mode works on day one;
  streaming is additive.
- **No multi-pick (`additionalAnchors`).** The field is already optional
  in the schema, so single-pick v1 is forward-compatible.

## Platform coverage

Metro (hence this design) backs both bare React Native and Expo. The
server adapter is identical for Expo since Expo uses Metro. The widget's
two native dependencies to verify across iOS / Android / Expo Go /
dev-client are `getInspectorDataForViewAtPoint` (RN core, dev-only) and
`react-native-view-shot`.

## How the package is split

The monorepo sets `strictPeerDependencies: true`, so a package that
*required* `react-native` peers (not installed in this repo) would break
every `pnpm install`. `@pinagent/react-native` sidesteps that by being a
**hybrid package**:

- **`src/server/`** — pure Node (deps: `@pinagent/agent-runner`,
  `nanoid`). This is what `tsdown` builds to `dist/server.*`, what `tsc`
  typechecks, and what the integration test exercises. No RN involved.
- **`src/native/`** — the RN widget. Ships as **TypeScript source**
  (listed in `files`, exported via the `react-native` / `default`
  conditions) so the consumer's Metro/Babel pipeline transpiles it. It's
  excluded from this package's `tsconfig` `include` because `react-native`
  types aren't installed here; it's typechecked in a consumer app
  instead.
- `react` / `react-native` / `react-native-view-shot` are declared as
  **optional** peer dependencies, so the monorepo install stays green
  while the README still documents the real requirement.

The Expo example under `example/` has its **own** `package.json` and is
**not** a workspace member (the `packages/*` glob only matches direct
children of `packages/`), so its heavy Expo/RN deps never enter the
monorepo lockfile.

## Status & remaining work

Done:

1. ✅ **Metro middleware adapter** — implemented and proven by
   `tests/metro-middleware.test.ts` (feedback POST → `.pinagent/db.sqlite`).
2. ✅ **Picker + screenshot + composer widget** — `src/native/`.
3. ✅ **Packaged** as `@pinagent/react-native` with a runnable Expo
   example and a `pinagent-setup` React Native guide.

Not yet (and not runnable in this repo — needs an RN toolchain +
simulator):

4. End-to-end run on a device/simulator (the example is ready to
   `npm install && npx expo start`).
5. Optional: WS streaming + Fast-Refresh re-anchoring + multi-pick.

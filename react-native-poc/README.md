# @pinagent/react-native (proof-of-concept)

Tap a view → leave a comment → an agent fixes it, for React Native &
Expo. This is the RN port of the Pinagent click-to-comment loop.

> **Status: proof-of-concept.** This package is intentionally **outside
> the pnpm workspace** (it's top-level `react-native-poc/`, not
> `packages/`). The monorepo runs `strictPeerDependencies: true`, so a
> package declaring `react-native` peers that aren't installed would
> break every `pnpm install`. It will move to `packages/react-native`
> once the RN toolchain is vendored. See
> [`docs/architecture/react-native.md`](../docs/architecture/react-native.md)
> for the full design and the web→RN mapping.

## How it works

The backend is **unchanged** from the web version — same
`.pinagent/db.sqlite`, same `Storage`, same `spawnAgent`, same
`@pinagent/mcp` pull mode. Only two things are RN-specific:

1. **The widget** (`src/`) — a `<Pinagent/>` component you mount at your
   app root. It uses RN's built-in Inspector
   (`getInspectorDataForViewAtPoint`) to turn a tap into a source
   `file:line:col`, `react-native-view-shot` for the screenshot, and the
   bundle URL to find the dev server.
2. **The Metro middleware** (`server/`) — a thin adapter that mounts the
   same `POST /__pinagent/feedback` route the Vite/Next plugins expose.

## Wiring it up (once RN deps exist)

**Client** — mount once at the app root:

```tsx
import { Pinagent } from '@pinagent/react-native';

export default function App() {
  return (
    <>
      <YourApp />
      <Pinagent />
    </>
  );
}
```

`<Pinagent/>` renders `null` in release builds (`__DEV__` gate).

**Server** — `metro.config.js`:

```js
const { pinagentMiddleware } = require('@pinagent/react-native/server');

module.exports = {
  server: {
    enhanceMiddleware: (metroMiddleware, server) =>
      pinagentMiddleware({ projectRoot: __dirname }).chain(metroMiddleware),
  },
};
```

**Agent pickup** — identical to the web flow. Either let the middleware
spawn agents (`spawnMode: 'inline' | 'worktree'`) or pull comments into a
Claude Code session over MCP (`@pinagent/mcp`).

## Files

| Path | Role |
| --- | --- |
| `src/Pinagent.tsx` | FAB + picker overlay + composer (the widget) |
| `src/inspector.ts` | tap point → `_debugSource` (RN analog of `data-pa-loc`) |
| `src/screenshot.ts` | `react-native-view-shot` capture → base64 PNG |
| `src/transport.ts` | derive dev-server URL, POST feedback |
| `src/types.ts` | `FeedbackInput` (mirrors `FeedbackInputSchema`) |
| `server/metro-middleware.ts` | mounts `/__pinagent/feedback` on Metro |

## v1 scope / known cuts

- Single-pick only (`additionalAnchors` left empty — schema-compatible).
- No live agent streaming into the widget; pull mode (MCP) works now.
- No Fast-Refresh pin re-anchoring (web does this via CSS selectors,
  which RN lacks). `selector` carries the component name chain instead.
- Inspector internals shift across RN versions; `inspector.ts` reads them
  defensively and degrades to `loc: null` rather than throwing.

## Next steps to productionize

1. Vendor the RN toolchain; move to `packages/react-native`.
2. Add an Expo example under `examples/` and an e2e check that a
   phone-filed comment lands in `.pinagent/db.sqlite`.
3. Extend the `pinagent-setup` skill with an RN/Expo branch.
4. Optional: WS streaming, multi-pick, Fast-Refresh re-anchoring.

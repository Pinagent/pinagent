# @pinagent/react-native

Tap a view → leave a comment → an agent fixes it, for **React Native &
Expo**. The RN port of the Pinagent click-to-comment loop.

The backend is **unchanged** from the web version — same
`.pinagent/db.sqlite`, same `Storage`, same `spawnAgent`, same
`@pinagent/mcp` pull mode. Only two pieces are RN-specific: a
`<Pinagent/>` widget you mount at your app root, and a Metro dev-server
middleware. Full design + web→RN mapping:
[`docs/architecture/react-native.md`](../../docs/architecture/react-native.md).

## Package layout (hybrid)

| Path | Built? | Typechecked here? | Notes |
| --- | --- | --- | --- |
| `src/server/` | yes → `dist/server.*` | yes | pure Node; the Metro middleware |
| `src/native/` | no — ships as source | no (needs RN types) | the RN widget; Metro transpiles it |
| `example/` | — | — | standalone Expo app, **not** a workspace member |

`react` / `react-native` / `react-native-view-shot` are **optional** peer
deps so the monorepo install stays green; a real consumer must provide
them. See [How the package is split](../../docs/architecture/react-native.md#how-the-package-is-split).

## Usage

**Client** — mount once at the app root (renders `null` in release builds):

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

`pinagentMiddleware` options: `projectRoot` (where `.pinagent/` lives) and
`spawnMode` (`false` | `'inline'` | `'worktree'`, default `'inline'`).

**Agent pickup** — identical to web. Either let the middleware spawn
agents, or pull comments into a Claude Code session over `@pinagent/mcp`.

A complete, runnable Expo app is in [`example/`](./example).

## How a tap becomes `file:line`

RN's dev Inspector already resolves a touch to a component + source via
`getInspectorDataForViewAtPoint`, reading each fiber's `_debugSource`
(populated by the `__source` Babel transform Metro runs in dev). That's
the RN analog of web's build-time `data-pa-loc`. `src/native/inspector.ts`
wraps it and degrades to `loc: null` (rather than throwing) across RN
version differences.

## v1 scope / known cuts

- Single-pick only (`additionalAnchors` left empty — schema-compatible).
- No live agent streaming into the widget; pull mode (MCP) works now.
- No Fast-Refresh pin re-anchoring; `selector` carries the component name
  chain (RN has no CSS selectors).

## Tests

`tests/metro-middleware.test.ts` drives the middleware against the real
`Storage` and asserts a feedback POST lands a conversation in
`.pinagent/db.sqlite`:

```bash
pnpm --filter @pinagent/agent-runner build   # test imports the built backend
pnpm exec vitest run packages/react-native
```

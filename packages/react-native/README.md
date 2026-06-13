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

See [Configuration](#configuration) for the full option/prop/env surface.

The middleware mounts `POST /__pinagent/feedback` **and** self-installs the
`/__pinagent/ws` live-streaming socket on Metro's own port, so a spawned
agent's run streams live into the app (text, tool calls, result) with
follow-ups and `ask_user` answering — the native counterpart of the web
widget's agent tray. Simulators and physical devices work with no extra config.

> The streaming socket rides the middleware (not `config.server.websocketEndpoints`)
> on purpose: **Expo's dev server ignores `websocketEndpoints`** and destroys
> any upgrade path it doesn't recognise, which would leave the in-app stream
> sheet stuck on "Connecting…". Routing through `enhanceMiddleware` — which Expo
> *does* honor — works under both Expo and bare Metro.

For an explicit bare-Metro setup you can still spread
`pinagentWebsocketEndpoints({ projectRoot })` into `config.server.websocketEndpoints`;
it's redundant with the middleware install but harmless.

**Agent pickup** — identical to web. Either let the middleware spawn
agents, or pull comments into a Claude Code session over `@pinagent/mcp`.

A complete, runnable Expo app is in [`example/`](./example).

## Configuration

### `pinagentMiddleware(opts)` — `metro.config.js`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `projectRoot` | `string` | — (required) | Where `.pinagent/` lives. Pass `__dirname`. |
| `spawnMode` | `false \| 'inline' \| 'worktree'` | `'inline'` | Same semantics as the Vite/Next plugins. `false` files the comment only (pull mode); `'inline'` runs the agent in-process and streams it back; `'worktree'` runs it in an isolated git worktree. |
| `apiKey` | `string` | — | Explicit API key for spawned agent runs. Bridged to the runner as `PINAGENT_AGENT_API_KEY`, exactly like the Vite plugin's `apiKey`. Omit to authenticate against your agentic subscription. |

```js
const { pinagentMiddleware } = require('@pinagent/react-native/server');

module.exports = {
  server: {
    enhanceMiddleware: (metroMiddleware, server) =>
      pinagentMiddleware({
        projectRoot: __dirname,
        spawnMode: 'inline',
        apiKey: process.env.MY_PINAGENT_KEY, // optional
      }).chain(metroMiddleware),
  },
};
```

### `<Pinagent />` props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `projectRoot` | `string` | Metro-injected, else `''` | Makes `_debugSource` file paths project-relative (matching the web babel plugin). |
| `screenName` | `string` | `Platform.OS` | Route/screen name recorded as the comment `url`. Restored pills are scoped to this value, so pass a stable per-screen name if you want per-screen restore. |

### Environment variables

| Var | Effect |
| --- | --- |
| `PINAGENT_AGENT_API_KEY` | The agent-run API key. Set it yourself, or let the `apiKey` middleware option set it. The `apiKey` option wins when both are present (it's applied on middleware construction). |
| `PINAGENT_EDITOR` | Editor command the dev server uses for tap-to-open (e.g. `code -g`). Falls back to common editor CLIs / macOS apps. |

**Pinagent never reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` implicitly.** The
`apiKey` option (→ `PINAGENT_AGENT_API_KEY`) is the only key input; with neither
set, runs fall back to your agentic subscription. RN has no dock, so there's no
runtime Connections store to override the option/env — the option/env is the
whole story.

## How a tap becomes `file:line`

RN's dev Inspector already resolves a touch to a component + source via
`getInspectorDataForViewAtPoint`, reading each fiber's `_debugSource`
(populated by the `__source` Babel transform Metro runs in dev). That's
the RN analog of web's build-time `data-pa-loc`. `src/native/inspector.ts`
wraps it and degrades to `loc: null` (rather than throwing) across RN
version differences.

## Multi-select

Tap **+ Add element** in the composer to add more targets to the same comment:
the composer steps aside, you tap another element, and it returns as a
removable chip. On submit, the extra targets ride along in `additionalAnchors`
(the same wire shape the web widget sends), landing in the
`widget_anchors.additional_anchors` column and reaching the agent as
`additionalTargets` — so a single comment like "make all these buttons match"
addresses every picked element. A single pick leaves `additional_anchors` null
(web parity). The screenshot is captured once, at the first pick.

## Scope / known cuts

- No Fast-Refresh pin re-anchoring; `selector` carries the component name
  chain (RN has no CSS selectors).
- Breadcrumb re-anchoring applies to the primary pick only; extras keep the
  location they were tapped with (web behaves the same).

Live agent streaming is wired automatically by `pinagentMiddleware`.

## Tests

`tests/metro-middleware.test.ts` drives the middleware against the real
`Storage` and asserts a feedback POST lands a conversation in
`.pinagent/db.sqlite`:

```bash
pnpm --filter @pinagent/agent-runner build   # test imports the built backend
pnpm exec vitest run packages/react-native
```

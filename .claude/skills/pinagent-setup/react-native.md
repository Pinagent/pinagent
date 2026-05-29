# React Native / Expo setup

Target: any React Native or Expo app using **Metro** in dev. Like the web
plugins, everything here is dev-only — the widget renders `null` under
`__DEV__ === false` and the middleware never runs in a release build.

> **How it differs from web.** There's no DOM, so there's no
> `data-pa-loc` attribute and no `<script>` injection. Instead the widget
> resolves a tapped view to its source via React Native's built-in
> Inspector (`getInspectorDataForViewAtPoint` → each fiber's
> `_debugSource`), which Metro already populates in dev through the
> `@babel/plugin-transform-react-jsx-source` transform. The agent backend
> (`.pinagent/db.sqlite`, `spawnAgent`, `@pinagent/mcp`) is identical.

## 1. Install

```bash
cd /path/to/target/app
pnpm add @pinagent/react-native
pnpm add -D react-native-view-shot   # screenshots; optional but recommended
```

`react`, `react-native`, and `react-native-view-shot` are peer deps the
app already provides (the last is what you just added). If
`react-native-view-shot` is absent the widget still works — it submits a
1×1 placeholder instead of a screenshot.

### Native build approval (pnpm only)

The agent backend uses `better-sqlite3` server-side. On pnpm 10+, approve
its build once or comment submission 500s:

```bash
pnpm approve-builds   # select better-sqlite3
pnpm install
```

(See the note in [vite.md](./vite.md) — same `better-sqlite3` caveat.)

## 2. Mount the widget at your app root

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

Optional props: `screenName` (recorded with the comment; defaults to the
OS name) and `projectRoot` (used to make source paths project-relative).

## 3. Mount the middleware in `metro.config.js`

```js
const { pinagentMiddleware } = require('@pinagent/react-native/server');

// Expo:
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// (bare RN: const { getDefaultConfig } = require('@react-native/metro-config'); )

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, _server) =>
    pinagentMiddleware({ projectRoot: __dirname }).chain(metroMiddleware),
};

module.exports = config;
```

`pinagentMiddleware` options:

- `projectRoot` — where `.pinagent/` lives. Usually `__dirname`.
- `spawnMode` — `'inline'` (default), `'worktree'`, or `false`. Same
  semantics as the Vite/Next `spawnAgent` option (see [vite.md](./vite.md)
  § Configuration knobs).

## 4. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for the MCP server and the `.gitignore`
entry — identical to web. The MCP server's `PINAGENT_PROJECT_ROOT` must
match the `projectRoot` you passed the middleware.

## Verify

```bash
# Start Metro (expo start / react-native start), note the dev-server URL it
# prints (e.g. http://192.168.1.5:8081), then:
curl -sS -X POST http://127.0.0.1:8081/__pinagent/feedback \
  -H 'content-type: application/json' \
  -d '{"comment":"hi","loc":null,"selector":"","url":"ios","viewport":{"w":1,"h":1},"userAgent":"test","screenshot":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","createdAt":"2026-01-01T00:00:00.000Z"}'
# expect: {"id":"...","agentSpawned":...}
```

Then in the app: tap 💬 → tap a component → the composer shows
`file:line` for the tapped component → submit → a row lands in
`<projectRoot>/.pinagent/db.sqlite` and the screenshot at
`.pinagent/screenshots/<id>.png`.

A complete runnable example is in
`packages/react-native/example/` (Expo).

## Caveats specific to RN

- **Device vs simulator hosts.** The widget derives the dev-server URL
  from the bundle URL (`NativeModules.SourceCode.scriptURL`), so a
  physical device hits the LAN host, the iOS simulator hits localhost,
  and the Android emulator hits `10.0.2.2` — all without configuration.
- **Inspector is dev-only.** Source resolution relies on RN internals
  present only in dev builds; in release the widget is compiled out
  entirely.
- **No CSS-selector re-anchoring or live WS streaming yet.** Pull mode
  (the MCP server / your `claude` session) and inline spawn both work on
  day one; live agent streaming into the widget is a follow-up. The
  `selector` field carries the component name chain instead of a CSS
  selector.

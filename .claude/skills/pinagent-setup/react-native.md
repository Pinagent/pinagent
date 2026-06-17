# React Native / Expo setup

Target: any React Native or Expo app using **Metro** in dev — managed Expo,
bare React Native, or either inside a monorepo. Like the web plugins,
everything here is dev-only: the widget renders `null` under
`__DEV__ === false` and the middleware never runs in a release build.

> **How it differs from web.** There's no DOM, so there's no `<script>`
> injection. The widget mounts as a `<Pinagent/>` component, and a tapped
> view resolves to `file:line` via React Native's built-in Inspector
> reading a `data-pa-loc` prop that a **Babel plugin** splices onto each
> JSX element at build time (step 2) — the RN analog of the web plugin's
> `data-pa-loc` DOM attribute. The agent backend (`.pinagent/db.sqlite`,
> `spawnAgent`, `@pinagent/mcp`) is identical to web.

> **Use the target app's package manager** for every command below. Expo
> and bare RN apps are usually npm/yarn/bun, not pnpm — substitute
> accordingly (`npm i` / `yarn add` / `bun add` / `pnpm add`). In a
> **monorepo**, run installs from the **app** workspace (where
> `metro.config.js` lives), and read [§5](#5-monorepo) first.

## 1. Install

`@pinagent/react-native` is plain JS/TS (no native module), so a normal
install works. `react-native-view-shot` *is* a native module — on Expo let
`expo install` pick the SDK-compatible version; on bare RN run pod install.

**Expo:**

```bash
npm i @pinagent/react-native
npx expo install react-native-view-shot   # screenshots; optional but recommended
```

**Bare React Native:**

```bash
npm i @pinagent/react-native
npm i react-native-view-shot               # screenshots; optional but recommended
cd ios && pod install && cd ..             # iOS: link view-shot's native part
```

`react`, `react-native`, and `react-native-view-shot` are declared as
**optional** peer deps — your app already provides `react`/`react-native`,
and if `react-native-view-shot` is absent the widget still works (it submits
a 1×1 placeholder instead of a screenshot).

## 2. Add the Babel source-tagging plugin

This is what makes a tap resolve to `file:line`. **React 19 / RN 0.81+
removed `_debugSource`**, so the old "Metro already populates it" path is
gone — without this plugin the picker shows *"Unknown component"* and
`loc: null`. The plugin is dev-only and injects a `data-pa-loc` prop the
Inspector reads back at tap time.

Add it to `babel.config.js` **before** the preset's JSX transform:

**Expo** (`babel-preset-expo`):

```js
const pinagentSource = require('@pinagent/react-native/babel').default;

module.exports = (api) => {
  api.cache(true);
  const dev = process.env.NODE_ENV !== 'production';
  return {
    presets: ['babel-preset-expo'],
    plugins: dev ? [pinagentSource] : [],
  };
};
```

**Bare React Native** (`@react-native/babel-preset`):

```js
const pinagentSource = require('@pinagent/react-native/babel').default;
const dev = process.env.NODE_ENV !== 'production';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: dev ? [pinagentSource] : [],
};
```

> Restart Metro with a cleared cache after editing Babel config:
> `npx expo start -c` (Expo) or `npm start -- --reset-cache` (bare RN).
> Babel output is cached aggressively; without `--reset-cache` the prop
> won't appear and taps stay unresolved.

## 3. Mount the widget at your app root

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

Optional props: `screenName` (recorded with the comment; defaults to
`Platform.OS`) and `projectRoot` (makes source paths project-relative; the
middleware injects it for you, so you rarely set it by hand).

## 4. Mount the middleware in `metro.config.js`

The middleware mounts `POST /__pinagent/feedback` and self-installs the
`/__pinagent/ws` live-stream socket on Metro's own port (so a spawned
agent's run streams back into the app).

**Expo** (`expo/metro-config`):

```js
const { getDefaultConfig } = require('expo/metro-config');
const { pinagentMiddleware } = require('@pinagent/react-native/server');

const config = getDefaultConfig(__dirname);
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, _server) =>
    pinagentMiddleware({ projectRoot: __dirname }).chain(metroMiddleware),
};

module.exports = config;
```

**Bare React Native** (`@react-native/metro-config` + `mergeConfig`):

```js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { pinagentMiddleware } = require('@pinagent/react-native/server');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  server: {
    enhanceMiddleware: (metroMiddleware, _server) =>
      pinagentMiddleware({ projectRoot: __dirname }).chain(metroMiddleware),
  },
});
```

`pinagentMiddleware` options:

- `projectRoot` — where `.pinagent/` lives. Usually `__dirname` (the app
  dir, **even in a monorepo** — see §5).
- `spawnMode` — `'inline'` (default), `'worktree'`, or `false`. Same
  semantics as the Vite/Next `spawnAgent` option (see [vite.md](./vite.md)
  § Configuration knobs). `false` files the comment only (pull mode).
- `apiKey` — explicit key for spawned runs, bridged as
  `PINAGENT_AGENT_API_KEY`. Omit to use your agentic subscription;
  pinagent never reads `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` implicitly.

> **Expo, not bare Metro, is why this rides `enhanceMiddleware`.** Expo's
> dev server ignores `config.server.websocketEndpoints` and destroys
> upgrade paths it doesn't recognise, which would strand the in-app stream
> on "Connecting…". Routing the socket through `enhanceMiddleware` (which
> Expo *does* honor) works under both Expo and bare Metro, so you don't
> need `websocketEndpoints` at all.

## 5. Monorepo

The RN bits don't change in a monorepo; two things need care — **where
storage lives** and **Metro resolution**.

- **`.pinagent/` lives in the app dir, and the MCP server points there.**
  Keep `pinagentMiddleware({ projectRoot: __dirname })` so storage is the
  app's own `.pinagent/`. But register the MCP server at the **monorepo
  root** (one `.mcp.json` there) so one agent session can edit the app
  *and* the shared packages a fix touches, and set that server's
  `PINAGENT_PROJECT_ROOT` to the **app dir** so it reads the same DB. This
  is the same root-vs-app split as web — see [mcp.md](./mcp.md) §2.

- **Metro must watch the workspace and find hoisted deps.** Point Metro at
  the repo root and both `node_modules` so it can resolve
  `@pinagent/react-native` (and your shared packages):

  ```js
  const path = require('node:path');
  const { getDefaultConfig } = require('expo/metro-config');
  const { pinagentMiddleware } = require('@pinagent/react-native/server');

  const projectRoot = __dirname;
  const workspaceRoot = path.resolve(projectRoot, '../..'); // adjust depth

  const config = getDefaultConfig(projectRoot);
  config.watchFolders = [workspaceRoot];
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ];
  config.server = {
    ...config.server,
    enhanceMiddleware: (metroMiddleware, _server) =>
      pinagentMiddleware({ projectRoot }).chain(metroMiddleware),
  };
  module.exports = config;
  ```

  (Bare RN: wrap the same `server`/`watchFolders`/`resolver` overrides in
  `mergeConfig(getDefaultConfig(projectRoot), { ... })`.)

- **`@pinagent/react-native`'s native client ships as TypeScript source**
  (Metro transpiles it via your Babel preset) — there's no build step, but
  Metro must be allowed to read it, which the `watchFolders` /
  `nodeModulesPaths` above cover.

- **pnpm workspaces:** Metro struggles with pnpm's symlinked store. Either
  set `node-linker=hoisted` in `.npmrc`, or ensure symlink resolution is on
  (Expo SDK 50+ handles it; bare RN needs Metro's resolver symlink support).
  npm/yarn workspaces "just work" with the config above.

## 6. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for the MCP server and the `.gitignore`
entry — identical to web (in a monorepo, gitignore `.pinagent/` at the repo
root). The MCP server's `PINAGENT_PROJECT_ROOT` must match the
`projectRoot` you passed the middleware.

## Verify

```bash
# Start Metro (expo start / react-native start), note the dev-server URL it
# prints (e.g. http://192.168.1.5:8081), then:
curl -sS -X POST http://127.0.0.1:8081/__pinagent/feedback \
  -H 'content-type: application/json' \
  -d '{"comment":"hi","loc":null,"selector":"","url":"ios","viewport":{"w":1,"h":1},"userAgent":"test","screenshot":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","createdAt":"2026-01-01T00:00:00.000Z"}'
# expect: {"id":"...","agentSpawned":...}
```

Then in the app: tap 💬 → tap a component → the composer shows `file:line`
for the tapped component (if it shows *"Unknown component"*, step 2's Babel
plugin isn't active — restart Metro with `-c` / `--reset-cache`) → submit →
a row lands in `<projectRoot>/.pinagent/db.sqlite` and the screenshot at
`.pinagent/screenshots/<id>.png`.

A complete runnable example is in `packages/react-native/example/` (Expo).

## Caveats specific to RN

- **Device vs simulator hosts.** The widget derives the dev-server URL from
  the bundle URL (`getDevServer()` under bridgeless RN, falling back to
  `NativeModules.SourceCode.scriptURL`), so a physical device hits the LAN
  host, the iOS simulator hits localhost, and the Android emulator hits
  `10.0.2.2` — all without configuration.
- **Dev-only.** Source resolution and the middleware rely on RN internals
  and Metro, present only in dev; release builds compile the widget out
  entirely (the Babel plugin is gated on `NODE_ENV !== 'production'`).
- **`selector` carries the component-name chain**, not a CSS selector (RN
  has none). Live agent streaming into the widget and multi-element select
  both work; the one cut vs web is Fast-Refresh pin re-anchoring.

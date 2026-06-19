# Pinagent × Expo example

A minimal Expo app that wires up `@pinagent/react-native`: tap the pin FAB,
tap a component, leave a comment — it POSTs to the Metro middleware and
lands in `.pinagent/db.sqlite`, where an agent (inline spawn, or your
Claude Code MCP session) picks it up.

> **Standalone app — not a workspace member.** It has its own
> `package.json` and heavy Expo/RN deps that intentionally don't enter the
> monorepo lockfile (the `packages/*` glob only matches direct children of
> `packages/`). Install and run it on its own.

## Run it

```bash
# 1. Build the Pinagent server entry the middleware imports:
pnpm --filter @pinagent/react-native build      # from the repo root

# 2. Install + start the example (its own dependency tree):
cd packages/react-native/example
npm install
npx expo start            # then press i (iOS sim) / a (Android emulator)
```

The two pinagent touch points are:

- **`App.tsx`** — `<Pinagent screenName="Home" />` mounted at the root.
- **`metro.config.js`** — `pinagentMiddleware(...).chain(...)` mounting
  `POST /__pinagent/feedback`.

In a real project (outside this monorepo) those imports are
`@pinagent/react-native` and `@pinagent/react-native/server`; here they
point at the in-tree source/build so the demo needs no publish.

## Verify a comment landed

After submitting from the app:

```bash
ls packages/react-native/example/.pinagent/screenshots   # the PNG
# and query the SQLite db, or point @pinagent/mcp at this projectRoot.
```

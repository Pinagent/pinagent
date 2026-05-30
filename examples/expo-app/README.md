# Pinagent × Expo example

A React Native (Expo) app wired up with `@pinagent/react-native`: tap the 💬 FAB,
tap any component, leave a comment — the RN inspector resolves your tap to the JSX
`file:line`, a screenshot is attached, and the record POSTs to the Metro middleware
and lands in `.pinagent/db.sqlite`, where an agent (inline spawn, or your Claude Code
MCP session) picks it up.

It's the Expo counterpart to the web demos in [`../react-vite`](../react-vite/) and
[`../next-app`](../next-app/), expanded into a couple of screens of per-file components
so the tap-to-`file:line` behavior is easy to see.

> **Standalone app — not a pnpm workspace member.** It's excluded from the workspace
> (see the `!examples/expo-app` line in the repo-root `pnpm-workspace.yaml`) so its
> Expo/RN 0.74 (React 18.2) dependency tree never enters the monorepo's React 19
> lockfile. Install and run it on its own with `npm`.

## Run it

```bash
# 1. Build the Pinagent server entry the Metro middleware imports (from the repo root):
pnpm --filter @pinagent/react-native build

# 2. Install + start the example (its own dependency tree):
cd examples/expo-app
npm install
npx expo start            # then press i (iOS sim) / a (Android emulator)
```

The two pinagent touch points are:

- **`App.tsx`** — `<Pinagent screenName={tab} />` mounted once at the root.
- **`metro.config.js`** — `pinagentMiddleware(...).chain(...)` mounting
  `POST /__pinagent/feedback`, plus a `watchFolders` entry so Metro can transpile
  the in-tree `@pinagent/react-native` source.

This demo imports `@pinagent/react-native` from in-tree source so it needs no publish
(`App.tsx` imports `../../packages/react-native/src/native`; `metro.config.js` requires
the built `../../packages/react-native/dist/server.js`). In a real project the imports
are a normal install of `@pinagent/react-native` / `@pinagent/react-native/server` and
the `watchFolders` / resolver lines aren't needed — just the `enhanceMiddleware` block.

## The full loop with Claude Code

`.mcp.json` registers the Pinagent MCP server pinned to this directory via
`PINAGENT_PROJECT_ROOT`, and `.claude/settings.local.json` pre-approves its tools.
With `spawnMode: 'inline'` (the default in `metro.config.js`) each submit also runs an
agent in-process. To drive the loop only from your own Claude Code session instead, set
`spawnMode: false` and let the MCP server feed the queue.

| `spawnMode` | Behavior |
|---|---|
| `'inline'` (default) | Each submit runs a Claude Agent SDK query in `projectRoot`. |
| `false` | No auto-spawn; pull the queue from your own Claude Code MCP session. |
| `'worktree'` | Each submit gets its own git worktree at `.pinagent/worktrees/<id>` on branch `pinagent/<id>` — true parallel agents, no edit races. Requires a git repo. |

> **`'worktree'` on React Native.** The worktree spawn itself is platform-agnostic
> (it runs in the Metro dev server on your machine, not on the device), so it works
> the same as on the web plugins. What's web-only is the **dock** — the "Open app"
> live preview and the Land / Discard buttons. There's no dock on RN, so review and
> merge each `pinagent/<id>` branch yourself with git (e.g. `git merge pinagent/<id>`),
> and run `npx expo start` against a worktree dir if you want to preview it.

## Verify a comment landed

```bash
ls examples/expo-app/.pinagent/screenshots   # the PNG
# and query .pinagent/db.sqlite, or point the MCP server at this projectRoot.
```

## Caveats

- **Dev-only.** Source resolution uses RN inspector internals present only in dev
  builds; in release builds (`__DEV__ === false`) `<Pinagent />` renders `null`.
- **Device vs simulator host** is auto-derived from Metro's bundle URL — physical
  device hits your LAN host, iOS simulator hits `localhost`, Android emulator hits
  `10.0.2.2`. No configuration needed.
- **Port 53636** (overridable via `PINAGENT_WS_PORT`) is used for the agent WebSocket;
  free it or set the env var if a stale dev server is holding it.
- **`.pinagent/`** under this directory holds the feedback records, screenshots, and
  SQLite db. Already gitignored.

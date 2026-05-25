# Vite + React setup

Target: any React app using Vite 5/6/7 in dev. The plugin is no-op on `vite build`.

## 1. Build & pack the plugin

From the pinpoint repo:

```bash
cd /Users/jacksonmalloy/code/pinpoint
pnpm --filter @pinpoint/widget build
pnpm --filter @pinpoint/vite-plugin build
cd packages/vite-plugin
pnpm pack
# produces pinpoint-vite-plugin-<version>.tgz
```

If pinpoint code hasn't changed since last pack, skip — the existing tarball is fine.

## 2. Install in the target

```bash
cd /path/to/target/repo
pnpm add -D /Users/jacksonmalloy/code/pinpoint/packages/vite-plugin/pinpoint-vite-plugin-<version>.tgz
```

If the consumer's `postinstall` hook is flaky (sherif lint, etc.) and rolls back the install, pass `--ignore-scripts` and the install will land cleanly — no pinpoint behavior depends on those scripts.

## 3. Add to `vite.config.ts`

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pinpoint from '@pinpoint/vite-plugin';

export default defineConfig({
  plugins: [pinpoint(), react()],
  // ...rest of existing config
});
```

Order matters loosely: `pinpoint()` registers `enforce: 'pre'` so it runs before React's transform. Don't worry about it — Vite handles ordering.

That's it for the build. The plugin handles:

- JSX tagging via the `transform` hook
- Widget injection via `transformIndexHtml`
- `/__pinpoint/*` middleware via `configureServer`

No layout/component changes needed (unlike Next).

## 4. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for the MCP server setup and `.gitignore` entry.

## Verify

```bash
cd /path/to/target && pnpm dev
# in another terminal:
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/__pinpoint/widget.js
# expect: 200
```

Then open the browser:

1. 💬 button bottom-right
2. Inspect any element → DOM has `data-pp-loc="src/Foo.tsx:42:7"`
3. Click 💬 → pick element → submit → file lands at `<root>/.pinpoint/feedback/`

## Configuration knobs

```ts
pinpoint({
  // Optional: override project root (where .pinpoint/ lands). Defaults to
  // Vite's `server.config.root`.
  root: '/explicit/path',

  // Optional: run a Claude Agent SDK query() on each submit (alternative to
  // channel mode). Don't combine with channel mode — pick one.
  autoTrigger: true,
  // or fine-grained:
  autoTrigger: {
    permissionMode: 'acceptEdits',  // | 'bypassPermissions' | 'default' | 'plan'
    model: 'claude-sonnet-4-6',     // any model the SDK accepts; optional
    maxTurns: 30,                   // optional cap
  },
});
```

Auth: by default uses the OAuth session from `claude login` (billed against your subscription). Set `ANTHROPIC_API_KEY` to bill the API account instead, or `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` for provider-backed auth.

The Vite plugin's `autoTrigger` serializes submits — if multiple comments arrive while a query is running, they're batched into one follow-up turn. No risk of parallel agents racing on the same files.

If neither autoTrigger nor channel mode is on, feedback sits on disk and the developer manually asks the agent ("what's pending?") — that's the spec-default pull mode.

## Features available in @pinpoint/next but NOT yet in @pinpoint/vite-plugin

These are roadmap items. If a user explicitly needs one of these in a Vite project, that's a real porting task:

- **Worktree spawn mode** (`spawnAgent: 'worktree'`) — true parallel agents in isolated git worktrees.
- **Click-to-open editor** — the `/__pinpoint/open` endpoint that spawns the developer's editor at file:line:col.
- **Hotkey customization via `window.__pinpointHotkey`** — actually this IS in the widget, so works for both, but only documented for Next currently.

Everything else (screenshot pipeline, hotkey defaults, Esc-to-close, focus-isolated iframe composer, file:line attribution) is identical across both runtimes because they share the same widget IIFE.

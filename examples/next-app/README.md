# Pinagent — Next.js example

A minimal Next.js App Router app wired up with `@pinagent/next-plugin`. Click an element in the browser, leave a comment, and a coding agent picks it up with the file, line, and a screenshot.

This example is the smoke test for the Next integration and the reference a new Next user copies from. The companion [Vite example](../react-vite/) demonstrates the same loop on the Vite adapter.

## Run it

```sh
pnpm install                                # from the repo root
pnpm --filter next-app-example dev
```

The example's `predev` hook builds `@pinagent/next-plugin` (and its upstream packages via turbo) before starting `next dev`, so the bundled plugin — including the inlined widget IIFE and the migrations copied from `@pinagent/db/drizzle/` — is what gets loaded. First start takes a couple of seconds; subsequent starts are turbo cache hits.

Open <http://localhost:3000>, click the Pinagent logo in the bottom-right, pick an element, leave a comment. The widget streams the agent's response back inline. The dock surface is also enabled here — click the bottom-left ink pin to open it.

## What it demonstrates

- One-line integration via `@pinagent/next-plugin/config`.
- The `<Pinagent />` Server Component that mounts the widget (and, when `dock: true`, the dock iframe) from a Next layout.
- Direct DOM elements and component-rendered subtrees both work — every JSX opening element is tagged with `data-pa-loc="<file>:<line>:<col>"` at transform time.
- The optional dock surface (`dock: true`) running alongside the per-element widget.

## The whole integration

Two touch points:

**`next.config.ts`** — wrap the config with `pinagent()`:

```ts
import pinagent from '@pinagent/next-plugin/config';
import type { NextConfig } from 'next';

const coreConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pinagent/ui'],
};

export default pinagent(coreConfig, { dock: true });
```

**`app/layout.tsx`** — drop `<Pinagent />` once at the root:

```tsx
import { Pinagent } from '@pinagent/next-plugin';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Pinagent />
      </body>
    </html>
  );
}
```

That's it. The wrapped config registers the babel transform, the `/__pinagent/*` route handlers, and the WebSocket server in dev; `<Pinagent />` injects the widget script (and the dock iframe when `dock: true`). Production builds leave the marker component as a no-op.

## Configure the agent loop

`pinagent(config, options?)` accepts the same options as the Vite plugin:

| Option         | Default   | Effect                                                                                                  |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `spawnAgent`   | `'inline'`| `'inline'` runs each submit in the project root; `'worktree'` isolates each run in `.pinagent/worktrees/<id>` on a `pinagent/<id>` branch; `'off'` (or `false`) disables auto-spawn entirely. |
| `dock`         | `false`   | When true, also mounts the dock iframe. Sets `NEXT_PUBLIC_PINAGENT_DOCK=1` so `<Pinagent />` injects both surfaces. |

This example uses the defaults plus `dock: true`. Auth: uses your `claude login` OAuth session by default (billed against your subscription). Export `ANTHROPIC_API_KEY` to bill the API account instead.

## Project layout

```
examples/next-app/
├── next.config.ts        ← the integration (pinagent(config, options))
├── package.json
├── tsconfig.json
└── app/
    ├── layout.tsx        ← <Pinagent /> mounted once at the root
    ├── page.tsx          ← demo content
    ├── Counter.tsx       ← elements to click on
    ├── CounterList.tsx
    └── docs/page.tsx
```

Application code is otherwise plain Next.js — nothing under `app/` knows about Pinagent except the single `<Pinagent />` import.

## Caveats

- **Dev-only by design.** The transform, widget injection, and `/__pinagent/*` route handlers are gated on `NODE_ENV !== 'production'`. `next build` produces an untouched production bundle.
- **Port 53636** (overridable via `PINAGENT_WS_PORT`) is bound by the WebSocket server when the dev server starts. Free that port or set the env var if you have a collision.
- **`.pinagent/`** under the project root is where feedback records, screenshots, and the SQLite mirror live. Already covered by the repo-root `.gitignore`.

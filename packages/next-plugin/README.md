# @pinagent/next-plugin

Next.js adapter for Pinagent. Wraps your `next.config.js` to install a dev-only JSX-tagging loader (webpack + Turbopack), exposes `/__pinagent/*` route handlers, and provides a `<Pinagent />` component for mounting the widget script.

Pairs with `@pinagent/mcp` (the stdio MCP server your coding agent talks to). Same shared `.pinagent/feedback/` storage as `@pinagent/vite-plugin`.

## Setup

### 1. Install

```bash
pnpm add -D @pinagent/next-plugin
```

Requires Next 14+ and React 18+. Verified on Next 16 with Turbopack.

### 2. Wrap your `next.config.js`

```js
import pinagent from '@pinagent/next-plugin/config';

const coreConfig = {
  // your existing Next config
};

export default pinagent(coreConfig);
```

If you also wrap with Sentry / other config wrappers, place `pinagent()` on the **inside**:

```js
export default withSentryConfig(pinagent(coreConfig), { /* sentry opts */ });
```

The wrapper registers a JSX-tagging loader (webpack + Turbopack) and a rewrite from `/__pinagent/*` to `/pinagent/*`. Both are dev-only — production builds are untouched.

### 3. Mount the widget in your root layout

```tsx
// app/layout.tsx
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

`<Pinagent />` is a client component that mounts the widget script via `useEffect` after hydration. It returns `null` during SSR, so it can't conflict with third-party script injectors (PostHog, GTM, etc.).

### 4. Create the route handler

Create `app/pinagent/[[...slug]]/route.ts` with **exactly** this content:

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export * from '@pinagent/next-plugin/route';
```

> **Why the folder is `pinagent/` not `__pinagent/`**: Next treats folders starting with `_` as private (not routable). The `pinagent(config)` wrapper adds a rewrite so the widget's hardcoded `/__pinagent/*` URLs land at your `/pinagent/*` route handler.
>
> **Why `dynamic` and `runtime` are inline, not re-exported**: Next 16 statically parses route-segment config and refuses to follow re-exports for those two fields.

### 5. Add to `.gitignore`

```bash
echo ".pinagent" >> .gitignore
```

Feedback records land at `<project root>/.pinagent/feedback/*.json` and screenshots at `.pinagent/screenshots/*.png`. In a monorepo, the project root is wherever Next is running from (typically `apps/<name>/`).

## Configure the MCP server

Same as the Vite case — register `@pinagent/mcp` so your coding agent can read feedback. In a monorepo, pin the project root explicitly:

```json
// apps/your-app/.mcp.json
{
  "mcpServers": {
    "pinagent": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/@pinagent/mcp/dist/index.js"],
      "env": {
        "PINAGENT_PROJECT_ROOT": "/absolute/path/to/apps/your-app"
      }
    }
  }
}
```

Then to push feedback into a running Claude Code session:

```bash
cd apps/your-app
claude --dangerously-load-development-channels server:pinagent
```

See `@pinagent/mcp` README for channel-mode details.

## Verifying it works

After restart:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/__pinagent/widget.js
# expect: 200
```

Then open the app in a browser:

1. A 💬 button appears bottom-right
2. Inspect any rendered element — its DOM node should have `data-pa-loc="src/Foo.tsx:42:7"`
3. Click 💬, pick something, submit a comment → a file lands in `.pinagent/feedback/`

## Caveats

- **Dev only.** The loader, the rewrite, and the `<Pinagent />` render are all `process.env.NODE_ENV === 'development'`-gated. Prod bundles are unchanged.
- **Turbopack:** the loader is registered under `turbopack.rules` for Next 15+, scoped to `*.{tsx,jsx}` to match the webpack rule (`/\.(t|j)sx$/`). Older Next versions (webpack-only dev) are handled by the webpack rule on the same config.
- **Path security:** the route reads `process.env.PINAGENT_PROJECT_ROOT || process.cwd()` for storage location. Set `PINAGENT_PROJECT_ROOT` in your `.mcp.json` to keep the MCP server and the route in sync, especially in monorepos.

## Deployment-shape support

Pinagent is a localhost dev tool. Its widget and every `/__pinagent/*` endpoint
are served from **root-absolute** paths, so a handful of Next-specific app shapes
need attention (none of which exist in the Vite adapter, whose middleware runs at
the server root). Vite users can ignore this whole section.

### `basePath` / `assetPrefix` (unsupported)

If your `next.config` sets `basePath` or `assetPrefix`, the app moves off the
server root but pinagent's hardcoded `/__pinagent/widget.js`, the dock iframe,
and the widget's own fetches (`/__pinagent/feedback`, `/db-worker.js`,
`/sqlite-wasm/*`) do **not** honor it — every one of them 404s and the widget
silently fails to load.

To make this fail loudly and early instead, `pinagent()` emits one grep-able
warning at dev-server start when it sees either field set:

```
[pinagent] basePath / assetPrefix is set in your Next config — pinagent's /__pinagent/* endpoints are served from root-absolute paths and don't honor either, so the widget will not load. basePath is unsupported; see https://github.com/Pinagent/pinagent/tree/main/packages/next-plugin#basepath--assetprefix-unsupported
```

There is no workaround other than running the pinagent dev session without a
`basePath` / `assetPrefix`. Threading a base path through the component, the
embedded widget IIFE, the rewrite, and every embedded fetch is a cross-package
change we'll only take on with real demand — open an issue if you need it.

### Custom `middleware.ts` / `proxy.ts`

`/__pinagent/*` requests flow through your `middleware.ts` like any other route.
An auth gate or redirect that catches them breaks the click→comment→agent loop
silently. Exclude pinagent's paths from your matcher:

```ts
// middleware.ts
export const config = {
  matcher: ['/((?!__pinagent).*)'],
};
```

If your middleware already uses a custom matcher, just make sure none of its
patterns match `/__pinagent` (and, if you do path matching inside the
middleware body, early-return for `req.nextUrl.pathname.startsWith('/__pinagent')`).

### Pages Router (unsupported for the route mount — App Router required)

The route mount is **App Router only**. The handler at
`@pinagent/next-plugin/route` exports App-Router Route Handler functions
(`GET`/`POST`/`PATCH`/`PUT`/`DELETE` taking a `Request` and returning a
`Response`) plus the `dynamic` / `runtime` route-segment config. A Pages Router
`pages/api/*` handler has a different contract entirely — `(req: NextApiRequest,
res: NextApiResponse)` — so the exports can't be re-used there; a `pages/api`
re-export does not work.

The JSX-tagging loader (webpack + Turbopack) and the `<Pinagent />` component
are router-agnostic and work fine in a Pages Router app — but you still need an
**App Router** route segment for the `/__pinagent/*` endpoints. App Router and
Pages Router coexist in the same project, so add the route mount under `app/`
even in an otherwise Pages-Router app:

```ts
// app/pinagent/[[...slug]]/route.ts — works alongside a pages/ tree
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export * from '@pinagent/next-plugin/route';
```

## Endpoints

| Method | Path                                    | Purpose                                            |
| ------ | --------------------------------------- | -------------------------------------------------- |
| GET    | `/__pinagent/widget.js`                 | Bundled widget IIFE (embedded at publish time).    |
| POST   | `/__pinagent/feedback`                  | Receive a comment + screenshot. Returns `{ id }`.  |
| GET    | `/__pinagent/feedback`                  | List all feedback (shallow, no screenshot blob).   |
| GET    | `/__pinagent/feedback/:id`              | Full record including base64 screenshot.           |
| GET    | `/__pinagent/feedback/:id/messages`     | Full agent transcript for one conversation.        |
| PATCH  | `/__pinagent/feedback/:id`              | Update `status`, `note`, `commitSha`.              |

### Transcript endpoint

`GET /__pinagent/feedback/:id/messages` returns the full persisted
agent transcript for one conversation — every `AgentEvent` that has
been appended to the bus, in insertion order. This is a non-streaming
HTTP read; for live updates, the dock uses a WebSocket subscription
instead. Intended for surfaces where a WebSocket is awkward (CLI,
export tooling, hosted dashboards) and as a cold-load prefetch the
dock fires alongside its WS subscribe so the detail view has content
before the socket connects.

Response shape:

```json
{
  "messages": [
    { "type": "init", "sessionId": "...", "model": "...", "permissionMode": "...", "apiKeySource": "..." },
    { "type": "text", "text": "..." },
    { "type": "tool_use", "name": "Edit", "summary": "src/Foo.tsx" },
    { "type": "tool_result", "ok": true }
  ]
}
```

Event shapes are pinned by `AgentEventSchema` in `@pinagent/shared`.
`init` and `result` events are included (the transcript view wants
them); the internal `__finished` bus sentinel is excluded. Status
codes: `400` on a malformed id, `404` on an unknown conversation,
`200` with `{ "messages": [] }` for a fresh conversation that hasn't
published anything yet.

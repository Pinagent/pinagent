# @pinpoint/next

Next.js adapter for Pinpoint. Wraps your `next.config.js` to install a dev-only JSX-tagging loader (webpack + Turbopack), exposes `/__pinpoint/*` route handlers, and provides a `<Pinpoint />` component for mounting the widget script.

Pairs with `@pinpoint/mcp` (the stdio MCP server your coding agent talks to). Same shared `.pinpoint/feedback/` storage as `@pinpoint/vite-plugin`.

## Setup

### 1. Install

```bash
pnpm add -D @pinpoint/next
```

Requires Next 14+ and React 18+. Verified on Next 16 with Turbopack.

### 2. Wrap your `next.config.js`

```js
import pinpoint from '@pinpoint/next/config';

const coreConfig = {
  // your existing Next config
};

export default pinpoint(coreConfig);
```

If you also wrap with Sentry / other config wrappers, place `pinpoint()` on the **inside**:

```js
export default withSentryConfig(pinpoint(coreConfig), { /* sentry opts */ });
```

The wrapper registers a JSX-tagging loader (webpack + Turbopack) and a rewrite from `/__pinpoint/*` to `/pinpoint/*`. Both are dev-only — production builds are untouched.

### 3. Mount the widget in your root layout

```tsx
// app/layout.tsx
import { Pinpoint } from '@pinpoint/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Pinpoint />
      </body>
    </html>
  );
}
```

`<Pinpoint />` is a client component that mounts the widget script via `useEffect` after hydration. It returns `null` during SSR, so it can't conflict with third-party script injectors (PostHog, GTM, etc.).

### 4. Create the route handler

Create `app/pinpoint/[[...slug]]/route.ts` with **exactly** this content:

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { GET, POST, PATCH } from '@pinpoint/next/route';
```

> **Why the folder is `pinpoint/` not `__pinpoint/`**: Next treats folders starting with `_` as private (not routable). The `pinpoint(config)` wrapper adds a rewrite so the widget's hardcoded `/__pinpoint/*` URLs land at your `/pinpoint/*` route handler.
>
> **Why `dynamic` and `runtime` are inline, not re-exported**: Next 16 statically parses route-segment config and refuses to follow re-exports for those two fields.

### 5. Add to `.gitignore`

```bash
echo ".pinpoint" >> .gitignore
```

Feedback records land at `<project root>/.pinpoint/feedback/*.json` and screenshots at `.pinpoint/screenshots/*.png`. In a monorepo, the project root is wherever Next is running from (typically `apps/<name>/`).

## Configure the MCP server

Same as the Vite case — register `@pinpoint/mcp` so your coding agent can read feedback. In a monorepo, pin the project root explicitly:

```json
// apps/your-app/.mcp.json
{
  "mcpServers": {
    "pinpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/@pinpoint/mcp/dist/index.js"],
      "env": {
        "PINPOINT_PROJECT_ROOT": "/absolute/path/to/apps/your-app"
      }
    }
  }
}
```

Then to push feedback into a running Claude Code session:

```bash
cd apps/your-app
claude --dangerously-load-development-channels server:pinpoint
```

See `@pinpoint/mcp` README for channel-mode details.

## Verifying it works

After restart:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/__pinpoint/widget.js
# expect: 200
```

Then open the app in a browser:

1. A 💬 button appears bottom-right
2. Inspect any rendered element — its DOM node should have `data-pp-loc="src/Foo.tsx:42:7"`
3. Click 💬, pick something, submit a comment → a file lands in `.pinpoint/feedback/`

## Caveats

- **Dev only.** The loader, the rewrite, and the `<Pinpoint />` render are all `process.env.NODE_ENV === 'development'`-gated. Prod bundles are unchanged.
- **Turbopack:** the loader is registered under `turbopack.rules` for Next 15+. Older Next versions (webpack-only dev) are handled by the webpack rule on the same config.
- **Custom middleware / `proxy.ts`:** `/__pinpoint/*` runs through your middleware like any other request. If your middleware blocks or transforms it, add an exclusion.
- **Path security:** the route reads `process.env.PINPOINT_PROJECT_ROOT || process.cwd()` for storage location. Set `PINPOINT_PROJECT_ROOT` in your `.mcp.json` to keep the MCP server and the route in sync, especially in monorepos.

## Endpoints

| Method | Path                            | Purpose                                            |
| ------ | ------------------------------- | -------------------------------------------------- |
| GET    | `/__pinpoint/widget.js`         | Bundled widget IIFE (embedded at publish time).    |
| POST   | `/__pinpoint/feedback`          | Receive a comment + screenshot. Returns `{ id }`.  |
| GET    | `/__pinpoint/feedback`          | List all feedback (shallow, no screenshot blob).   |
| GET    | `/__pinpoint/feedback/:id`      | Full record including base64 screenshot.           |
| PATCH  | `/__pinpoint/feedback/:id`      | Update `status`, `note`, `commitSha`.              |

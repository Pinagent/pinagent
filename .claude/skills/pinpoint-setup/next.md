# Next.js setup

Target: any Next 14+ App Router project. Verified on Next 16 + React 19 + Turbopack. Pages Router is not officially supported in v1.

## 1. Build & pack the adapter

From the pinpoint repo:

```bash
cd /Users/jacksonmalloy/code/pinpoint
pnpm --filter @pinpoint/widget build
pnpm --filter @pinpoint/next build
cd packages/next
pnpm pack
# produces pinpoint-next-<version>.tgz
```

If you've packed before and the contents change, **bump the version in `packages/next/package.json` first** — pnpm caches by tarball filename and otherwise won't re-extract. Same goes for editing the consumer's `package.json` to point at the new version.

## 2. Install in the target

```bash
cd /path/to/target/repo
pnpm add -D /Users/jacksonmalloy/code/pinpoint/packages/next/pinpoint-next-<version>.tgz
```

Use `--ignore-scripts` if the consumer's monorepo postinstall hook (sherif, lint, etc.) fails and rolls back the install. Pinpoint's own behavior doesn't depend on the consumer's postinstall.

## 3. Wrap `next.config.{js,ts}`

```js
import pinpoint from '@pinpoint/next/config';

const coreConfig = {
  // ...existing config
};

// If wrapping with Sentry or others, put pinpoint() on the INSIDE:
export default withSentryConfig(pinpoint(coreConfig), { /* sentry opts */ });

// Otherwise:
export default pinpoint(coreConfig);
```

What `pinpoint(config)` does:

- Adds a JSX-tagging loader to both webpack (Next ≤15 default) and Turbopack (Next 16 default). Dev-only — production builds are untouched.
- Adds a rewrite from `/__pinpoint/*` → `/pinpoint/*`. **Required** because Next treats folders starting with `_` as private (not routable), so we can't mount the route at `app/__pinpoint/`.
- Merges with existing `rewrites()` (function or array form). Won't clobber.

## 4. Mount `<Pinpoint />` in the root layout

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

`<Pinpoint />` is a client component (`'use client'` is baked into the bundle). It renders `null` during SSR and mounts the widget script via `useEffect` after hydration. **This is on purpose** — server-rendering a `<script>` tag would conflict with third-party script injectors (PostHog, GTM, Hotjar) that mutate `<body>` before React hydrates, producing hydration mismatch errors.

In production builds the component returns `null` unconditionally.

## 5. Create the route handler

Create the file **exactly** as below — don't be tempted to one-line the re-export:

```ts
// app/pinpoint/[[...slug]]/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { GET, POST, PATCH } from '@pinpoint/next/route';
```

Why `dynamic` and `runtime` are inline: Next 16 statically parses route-segment config at build time and refuses to follow re-exports for those fields. If you write `export { dynamic, runtime } from '@pinpoint/next/route'` you'll get:

```
Next.js can't recognize the exported `dynamic` field in route. It mustn't be reexported.
```

Why the folder is `pinpoint/` not `__pinpoint/`: same `_` private-folder rule. The `pinpoint(config)` wrapper's rewrite forwards the public URL `/__pinpoint/*` (which the widget POSTs to) onto this `/pinpoint/*` route.

## 6. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for MCP server setup and `.gitignore`.

## Verify

```bash
cd /path/to/target && pnpm dev   # uses the existing dev script
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/__pinpoint/widget.js
# expect: 200
```

Then open the browser and confirm:

1. 💬 button bottom-right
2. Inspect any element → DOM has `data-pp-loc="src/Foo.tsx:42:7"`
3. No hydration warnings in DevTools console
4. Submit a comment → file lands at `<project root>/.pinpoint/feedback/`

## Known gotchas

- **Turbopack first compile is slow.** Expect 30-60s the first time the loader runs — Turbopack recompiles every `.tsx` to add `data-pp-loc`. HMR is fast after that.
- **`color-scheme: dark` on the host page** styles form controls inside the widget's shadow root with dark browser defaults. The widget IIFE already counters this with `color-scheme: light` on the shadow host — no action needed, but if you see a dark textarea, the installed IIFE is stale and the consumer needs to bump and reinstall.
- **CSP `connect-src` blocking the widget's image inlining.** The widget skips cross-origin `<img>` elements during screenshot capture to avoid CSP/CORS fetch errors. Those images appear as blank slots in the agent's screenshot. To get them captured, either (a) add the CDN to `connect-src`, or (b) proxy them through a same-origin Next rewrite (like you might already do for analytics).
- **Custom middleware (`proxy.ts`).** `/__pinpoint/*` runs through every middleware just like other routes. If your middleware rejects unknown paths, add an exclusion.

## Configuration

The Next adapter doesn't accept options yet — auto-trigger is a Vite-plugin-only feature. For Next, use channel mode (see [mcp.md](./mcp.md)).

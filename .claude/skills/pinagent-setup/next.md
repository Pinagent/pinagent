# Next.js setup

Target: any Next 14+ App Router project. Verified on Next 16 + React 19 + Turbopack. Pages Router is not officially supported in v1.

## 1. Install the adapter

```bash
cd /path/to/target/repo
pnpm add -D @pinagent/next-plugin
```

Use `--ignore-scripts` if the consumer's monorepo postinstall hook (sherif, lint, etc.) fails and rolls back the install. Pinagent's own behavior doesn't depend on the consumer's postinstall.

## 2. Wrap `next.config.{js,ts}`

```js
import pinagent from '@pinagent/next-plugin/config';

const coreConfig = {
  // ...existing config
};

// pinagent(config, options?) takes an optional second arg:
const wrapped = pinagent(coreConfig, {
  spawnAgent: 'inline',   // 'inline' (default) | 'worktree' | false — see "Configuration" below
});

// If wrapping with Sentry or others, put pinagent() on the INSIDE:
export default withSentryConfig(wrapped, { /* sentry opts */ });

// Otherwise:
export default wrapped;
```

What `pinagent(config, options?)` does:

- Adds a JSX-tagging loader to both webpack (Next ≤15 default) and Turbopack (Next 16 default). Dev-only — production builds are untouched.
- Adds a rewrite from `/__pinagent/*` → `/pinagent/*`. **Required** because Next treats folders starting with `_` as private (not routable), so we can't mount the route at `app/__pinagent/`.
- Merges with existing `rewrites()` (function or array form). Won't clobber.
- Sets `PINAGENT_SPAWN_AGENT` env var so the route handler knows whether to spawn an agent per submit. See "Configuration" below.

## 3. Mount `<Pinagent />` in the root layout

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

`<Pinagent />` is a client component (`'use client'` is baked into the bundle). It renders `null` during SSR and mounts the widget script via `useEffect` after hydration. **This is on purpose** — server-rendering a `<script>` tag would conflict with third-party script injectors (PostHog, GTM, Hotjar) that mutate `<body>` before React hydrates, producing hydration mismatch errors.

In production builds the component returns `null` unconditionally.

**Placement.** Mount `<Pinagent />` as the **last child of `<body>`, outside your provider tree** (PostHog, `QueryClientProvider`, theme providers, etc.). It's fully self-contained — shadow-root UI with its own state — so it needs none of your app context, and keeping it outside the providers means it won't re-render with your app. The bare `<body>{children}<Pinagent /></body>` above is the minimal case; a real root layout usually wraps `{children}` in providers, so put `<Pinagent />` *after* that wrapper but still inside `<body>`.

## 4. Create the route handler

Create the file **exactly** as below — don't be tempted to one-line the re-export:

```ts
// app/pinagent/[[...slug]]/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export * from '@pinagent/next-plugin/route';
```

`export *` re-exports whatever HTTP verbs the installed `@pinagent/next-plugin` build exposes — `GET/POST/PATCH` cover the core feedback loop, and `PUT/DELETE` (present on builds that ship the dock) back its connection and branch management. The wildcard keeps this file working across plugin versions; a fixed verb list breaks with "Export DELETE doesn't exist in target module" whenever the template and the installed plugin drift.

Why `dynamic` and `runtime` are inline: Next 16 statically parses route-segment config at build time and refuses to follow re-exports for those fields. If you write `export { dynamic, runtime } from '@pinagent/next-plugin/route'` you'll get:

```
Next.js can't recognize the exported `dynamic` field in route. It mustn't be reexported.
```

Why the folder is `pinagent/` not `__pinagent/`: same `_` private-folder rule. The `pinagent(config)` wrapper's rewrite forwards the public URL `/__pinagent/*` (which the widget POSTs to) onto this `/pinagent/*` route.

## 5. Exclude pinagent's paths from existing middleware

**Do this whenever the app has a middleware/proxy file — skip it only if there is none.** Check for, in this order:

```bash
# Next looks for the file NEXT TO the app dir. If routes live in src/app,
# the middleware lives in src/, NOT the repo root.
ls middleware.ts middleware.js proxy.ts proxy.js \
   src/middleware.ts src/middleware.js src/proxy.ts src/proxy.js 2>/dev/null
```

(Next 16 renamed `middleware` → `proxy`; older versions use `middleware`. Same semantics.)

**Why this matters.** Middleware always runs **before** `next.config` rewrites. The `pinagent(config)` wrapper forwards the public `/__pinagent/*` URL onto the `/pinagent/*` route via a rewrite — but if the app's middleware has a broad catch-all `matcher`, it intercepts `/__pinagent/*` first and rewrites/mangles the path (e.g. next-intl treats `__pinagent` as a locale segment and prepends `/en`), so the pinagent rewrite never matches its destination and **every pinagent endpoint 404s**. The dock and click-to-fix loop then break silently. This is **not** pinagent-specific — any catch-all matcher shadows the rewrite. The usual offenders are **next-intl, NextAuth/Clerk, and custom redirect/geo middleware**; a passthrough middleware still mangles the path, so "my middleware doesn't block anything" is not a reason to skip this.

**The fix.** Add `__pinagent` and `pinagent` to the matcher's exclusion so the middleware doesn't touch either the public endpoint prefix or the rewrite destination. For the common negative-lookahead regex form, splice the two tokens into the existing `(?!...)` group — don't rewrite the regex wholesale:

```diff
  export const config = {
    matcher: [
-     '/((?!api|_next|_vercel|.*\\..*).*)',
+     // __pinagent = pinagent's public dev endpoints; pinagent = the rewrite target route
+     '/((?!api|_next|_vercel|__pinagent|pinagent|.*\\..*).*)',
    ],
  };
```

Matcher syntax varies — handle what's actually there:

- **Single regex string** or **array of regexes**: add `__pinagent|pinagent` to the negative-lookahead of **every** entry that could match `/__pinagent/*` (an array like `['/', '/(de|en)/:path*', '/((?!...).*)']` needs it on each broad entry).
- **No `config.matcher` at all** (middleware runs on every request): add an early passthrough at the top of the middleware function:

  ```ts
  if (request.nextUrl.pathname.startsWith('/__pinagent') ||
      request.nextUrl.pathname.startsWith('/pinagent')) {
    return; // or NextResponse.next() — let pinagent's rewrite handle it
  }
  ```

Don't assume the existing matcher excludes `_next`/`api` in any particular way — parse what's there and add the two pinagent tokens to it rather than replacing the whole pattern.

**Restart the dev server** after editing — middleware/proxy is compiled at server startup and does **not** hot-reload. Then verify the regex still routes real paths and skips pinagent's:

```bash
node -e 'const re=new RegExp("^/((?!api|_next|_vercel|__pinagent|pinagent|.*\\..*).*)$");
["/","/pricing","/de/pricing","/__pinagent/branches","/pinagent/x","/api/foo"].forEach(p=>
console.log((re.test(p)?"MATCH":"skip "),p));'
# "/", "/pricing", "/de/pricing" → MATCH (still routed); "/__pinagent/..", "/pinagent/..", "/api/.." → skip
```

> **Separate src/ gotcha:** a root-level `middleware.ts`/`proxy.ts` is **silently ignored** when routes live in `src/app` — Next only reads it from `src/`. A misplaced file produces the same 404 symptom (the middleware never runs, but neither does any exclusion you'd add to it). Confirm the file sits next to the app dir.

## 6. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for MCP server setup and `.gitignore`.

## Verify

First, a static read-only check of the wiring (no dev server needed):

```bash
cd /path/to/target && pnpm dlx @pinagent/cli doctor
# ✓ plugin + ./config + ./route resolve, config wrapped, <Pinagent /> mounted,
#   route handler correct, .pinagent gitignored, .mcp.json + project root OK
```

Then run the dev server and hit the widget endpoint:

```bash
cd /path/to/target && pnpm dev   # uses the existing dev script
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/__pinagent/widget.js
# expect: 200
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/__pinagent/branches
# expect: 200 — a 404 here while the app has a middleware/proxy file means a
# catch-all matcher is shadowing the rewrite (see step 5). widget.js can 200
# while the dynamic endpoints 404, so check a routed endpoint, not just the asset.
```

Grab `<port>` from the app's own dev script — it's often **not** 3000 (e.g. a custom `next dev -p 3434`). And note: **changes to `next.config.*` or the plugin wiring need a dev-server restart, not just HMR** — Next reads them at boot.

Then open the browser and confirm:

1. 💬 button bottom-right
2. Inspect any element → DOM has `data-pa-loc="src/Foo.tsx:42:7"`
3. No hydration warnings in DevTools console
4. Submit a comment → a row lands in `<project root>/.pinagent/db.sqlite` and the screenshot at `.pinagent/screenshots/<id>.png`

## Widget architecture (so you don't get confused debugging)

The composer (textarea + Submit/Cancel) renders inside an **iframe** mounted from the widget's shadow root. The 💬 FAB and the picker outline are in shadow DOM only. The iframe is needed because focus traps from modal libraries (Radix Dialog, react-focus-lock, etc.) reach across shadow-root boundaries — they cannot reach into an iframe document.

When the developer clicks the textarea: focus moves into the iframe's document, the parent-doc focus moves to the iframe element. Even if the host modal's focus trap fires and refocuses Cancel, keyboard input is still routed by the browser to the iframe (where the actual active element lives).

If you ever need to inspect the composer in DevTools, drill into the iframe element inside `<div id="pinagent-root">` in the parent DOM tree.

## Known gotchas

- **Turbopack first compile is slow.** Expect 30-60s the first time the loader runs — Turbopack recompiles every `.tsx` to add `data-pa-loc`. HMR is fast after that.
- **`color-scheme: dark` on the host page** styles form controls inside the widget with dark browser defaults. The widget IIFE counters this with explicit `color-scheme: light` and explicit backgrounds — no action needed, but if you see a dark textarea, the installed IIFE is stale (upgrade `@pinagent/next-plugin` and hard-refresh).
- **CSP `connect-src` blocking the widget's image inlining.** The widget uses `html-to-image.toBlob()` + `createImageBitmap()` + `canvas.toBlob()` — no `fetch()` calls. It also skips cross-origin `<img>` elements before they're inlined (CSP would block those fetches). Cross-origin images appear as blank slots in the captured screenshot. To get them captured, either (a) add the CDN to `connect-src`, or (b) proxy them through a same-origin Next rewrite (like you might do for analytics).
- **CSP `connect-src` blocking the widget WebSocket.** If the app sends its own Content-Security-Policy, the widget's dev WebSocket (`ws://127.0.0.1:<PINAGENT_WS_PORT>/__pinagent/ws`, default port 53636) and its `http://127.0.0.1:*` feedback POSTs must be allow-listed in `connect-src`. **`localhost` and `127.0.0.1` are different CSP origins** — allow-listing one does not cover the other, so include **both** loopback forms for dev: `connect-src ... ws://localhost:* wss://localhost:* http://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:*`. Symptom: the widget loads but the inline streaming pane never connects, with a `connect-src` violation in the console. The agent still runs server-side, so fixes appear to land while the pane stays blank. On Next this CSP is usually emitted from middleware (`proxy.ts` in Next 16, `middleware.ts` before that), which is compiled at startup and does **not** hot-reload — **restart the dev server** (not just hard-refresh) after editing the CSP, then hard-refresh.
- **Framing headers blocking the dock iframe (`dock: true` only).** The dock is a same-origin iframe served from `/__pinagent/dock/*`, so it inherits the app's security headers. Two headers each **independently** block it, and fixing only one still leaves the frame dead:
  - `X-Frame-Options: DENY` blocks **all** framing, including same-origin. Set `SAMEORIGIN` in dev (there is no value that allows same-origin-only beyond `SAMEORIGIN`).
  - CSP `frame-ancestors 'none'` does the same; it needs `'self'` to permit same-origin framing. If your CSP also sets `frame-src`, include `'self'` (and `http://localhost:*`) there too.

  Symptom: the dock area is blank / shows a broken-image placeholder and the console logs `Framing 'http://localhost:<port>/' violates the following Content Security Policy directive: "frame-ancestors 'none'". The request has been blocked.` (and/or an `X-Frame-Options` framing rejection). The per-element widget and its WebSocket still work, so it looks like pinagent loaded ("[pinagent:db] browser cache ready") but the dock is dead. Gate both headers on dev and keep production locked:

  ```ts
  const isDevelopment = process.env.NODE_ENV === 'development';
  // X-Frame-Options: DENY blocks same-origin framing too — the dock needs SAMEORIGIN in dev.
  response.headers.set('X-Frame-Options', isDevelopment ? 'SAMEORIGIN' : 'DENY');
  // CSP
  const cspDirectives = [
    // ...
    isDevelopment ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    `frame-src 'self'${isDevelopment ? ' http://localhost:*' : ''}`,
  ];
  ```

  This is the framing sibling of the `connect-src` exception above. Like that one, the headers are usually emitted from middleware (`proxy.ts` in Next 16, `middleware.ts` before that), which is compiled at startup and does **not** hot-reload — **restart the dev server** (not just hard-refresh) after editing them, then hard-refresh.
- **Custom middleware (`proxy.ts` in Next 16, `middleware.ts` before that) shadowing the rewrite.** `/__pinagent/*` runs through middleware **before** `next.config` rewrites, so a broad catch-all `matcher` (next-intl, NextAuth/Clerk, geo/redirect middleware) intercepts and mangles the path and **every pinagent endpoint 404s** — even a passthrough middleware does this, because locale/path rewriting happens before pinagent's own rewrite resolves. This is the single most common Next install failure when the app already has middleware. Fix: exclude `__pinagent` and `pinagent` from the matcher — see **step 5** for the per-syntax patterns. Symptom check: `curl .../__pinagent/branches` returns 404 (while `widget.js` may still 200). Restart the dev server after editing (middleware is compiled at startup, no HMR). Also confirm the middleware/proxy file sits **next to the app dir** (`src/` when routes are in `src/app`) — a misplaced file is silently ignored and 404s the same way.
- **Sherif / monorepo postinstall.** `pnpm add` may roll back due to unrelated workspace lint failures. Use `--ignore-scripts` to skip the postinstall hook on installs of pinagent-only.
- **Stale `@pinagent/*` symlinks from an earlier attempt.** The package is **`@pinagent/next-plugin`** — there is no `@pinagent/next`. If a previous or aborted install left a broken symlink under `node_modules/@pinagent/` (e.g. a dangling `@pinagent/next`), module resolution can fail in confusing ways even after a correct reinstall. `pnpm dlx @pinagent/cli doctor` flags dangling `@pinagent/*` symlinks; remove the broken links and reinstall.

### Dev security-header / CSP reference

If your app ships a Content-Security-Policy or framing-protection headers, these are the dev-only relaxations pinagent needs. Production stays fully locked — every relaxation is gated on `NODE_ENV === 'development'`. After editing any of these in middleware (`proxy.ts` / `middleware.ts`), **restart the dev server** (they're compiled at startup and don't hot-reload), then hard-refresh.

| Header / directive | Needed by | Dev value |
| --- | --- | --- |
| CSP `connect-src` | Widget dev WebSocket + feedback POSTs | both loopback forms: `ws://localhost:* wss://localhost:* http://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:*` |
| CSP `frame-src` | Dock iframe (`dock: true`) | `'self' http://localhost:*` |
| CSP `frame-ancestors` | Dock iframe (`dock: true`) | `'self'` (vs `'none'` in prod) |
| `X-Frame-Options` | Dock iframe (`dock: true`) | `SAMEORIGIN` (vs `DENY` in prod) — not a CSP directive, but same effect and easy to forget |

`connect-src` is needed for **any** install; the three framing rows only matter with `dock: true`. `localhost` and `127.0.0.1` are distinct CSP origins, so `connect-src` must list **both**.

## Configuration

### Plugin options (`pinagent(config, options)`)

```ts
pinagent(coreConfig, {
  /**
   * Each Submit runs a Claude Agent SDK query.
   *
   *  - 'inline' (default, V2): runs the SDK with cwd = main project dir.
   *    Streams events back to the widget's iframe pane in real time.
   *    Parallel agents may race on the same files.
   *  - 'worktree': creates `.pinagent/worktrees/<id>` on branch
   *    `pinagent/<id>` from current HEAD, then runs the SDK with `cwd`
   *    set to that worktree. True parallel agents, no edit races.
   *    Requires a git repo. Review each branch like a PR.
   *  - 'off' (or `false`): no spawn. Use channel mode or pull mode
   *    instead — the comment lands on disk, nothing else happens.
   *
   * Auth: by default uses the OAuth session from `claude login` (billed
   * against your subscription). Set ANTHROPIC_API_KEY to bill the API
   * account, or CLAUDE_CODE_USE_BEDROCK/_VERTEX/_FOUNDRY for provider auth.
   */
  spawnAgent: 'inline',
});
```

### Dock surface (optional)

The per-element widget ships by default. The **dock** is a second, opt-in surface — a project-management UI (Conversations, Changes with inline diffs, Branches, PRs, Connections, History) mounted from a bottom-left FAB. Enable it with `dock: true`:

```js
pinagent(coreConfig, { dock: true });   // combine with spawnAgent if you want both
```

> **The dock is a same-origin iframe** (mounted at `/__pinagent/dock/*`), not just
> shadow DOM. If your app emits `X-Frame-Options` or a CSP `frame-ancestors`
> directive, you **must allow same-origin framing in dev** or the dock renders as a
> blank area with a broken-image icon — the per-element widget keeps working, so it
> looks like pinagent loaded but the dock is dead. Both headers block it
> *independently*, so relax **both**: `X-Frame-Options: SAMEORIGIN` (there's no value
> that permits same-origin-only beyond `SAMEORIGIN`; `DENY` blocks even same-origin
> frames) and CSP `frame-ancestors 'self'` (plus `frame-src 'self'` if your CSP sets
> `frame-src`). Keep production fully locked (`DENY` / `'none'`) — see the framing
> pitfall under "Known gotchas" for the dev-only gating pattern.

When using the dock:

- The route handler uses `export *`, so it re-exports whatever HTTP verbs the installed `@pinagent/next-plugin` build provides — `GET, POST, PATCH`, plus `PUT, DELETE` on builds that ship the dock's Connections/Branches panels (see step 4). Using `export *` keeps the route working across plugin versions; keep `dynamic`/`runtime` inline since Next won't follow re-exports for route-segment config.
- The PR composer needs a GitHub token: set `GITHUB_TOKEN` or `PINAGENT_GITHUB_TOKEN` (tried in that order).
- If your app sets framing-protection headers (`X-Frame-Options` / CSP `frame-ancestors`), relax them for same-origin framing in dev — see the callout above and the "Known gotchas" framing pitfall.
- Optionally install `@pinagent/vscode-extension` — it lets the dock open a Claude Code terminal with a conversation piped in.

Full dock docs (routes, shortcuts, deep links) live in `@pinagent/widget-dock`'s README.

### Environment variables

| Var | Purpose | Default |
| --- | --- | --- |
| `PINAGENT_PROJECT_ROOT` | Project root for `.pinagent/` storage. Set in `.mcp.json` env block. | `process.cwd()` |
| `PINAGENT_SPAWN_AGENT` | `inline` (V2 default) / `worktree` / `off`. Set by the `spawnAgent` option or manually. | `inline` |
| `PINAGENT_AGENT_PERMISSION_MODE` | Passed to the Agent SDK as `permissionMode`. | `acceptEdits` |
| `ANTHROPIC_API_KEY` | Optional. If set, the Agent SDK bills the API account instead of the OAuth subscription from `claude login`. Alternatives: `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY` + their respective provider credentials. | unset (use OAuth) |
| `PINAGENT_EDITOR` | Editor for the "click file:line:col to open" feature. Honored before `EDITOR` and `VISUAL`. | unset; falls back to `EDITOR`, `VISUAL`, then `code` |

### Hotkey customization (browser-side)

Default hotkey is `c` to toggle pick mode. To change or disable, set a global before the widget script loads:

```tsx
// app/layout.tsx — inline script before <Pinagent />
{process.env.NODE_ENV === 'development' && (
  <script
    dangerouslySetInnerHTML={{ __html: 'window.__pinagentHotkey="p"' }}
  />
)}
<Pinagent />
```

`window.__pinagentHotkey = false` disables the hotkey entirely (only the 💬 FAB works). The hotkey ignores keypresses while typing in any input/textarea/contenteditable.

### Click-to-open editor

Each composer has a clickable `file:line:col` line at the top. Click it → server spawns the editor via `/__pinagent/open`. Supports VSCode (`code`, `code-insiders`), Cursor, Windsurf, VSCodium, Zed, Sublime, JetBrains family (IDEA, WebStorm, PyCharm, etc.), Atom, TextMate. CLI must be on PATH (in VSCode, "Shell Command: Install 'code' command in PATH" if needed).

# Next.js setup

Target: any Next 14+ App Router project. Verified on Next 16 + React 19 + Turbopack. Pages Router is not officially supported in v1.

## 1. Build & pack the adapter

From the pinagent repo:

```bash
cd /Users/jacksonmalloy/code/pinagent
pnpm --filter @pinagent/widget build
pnpm --filter @pinagent/next build
cd packages/next
pnpm pack
# produces pinagent-next-<version>.tgz
```

If you've packed before and the contents change, **bump the version in `packages/next/package.json` first** — pnpm caches by tarball filename and otherwise won't re-extract. Same goes for editing the consumer's `package.json` to point at the new version.

## 2. Install in the target

```bash
cd /path/to/target/repo
pnpm add -D /Users/jacksonmalloy/code/pinagent/packages/next/pinagent-next-<version>.tgz
```

Use `--ignore-scripts` if the consumer's monorepo postinstall hook (sherif, lint, etc.) fails and rolls back the install. Pinagent's own behavior doesn't depend on the consumer's postinstall.

## 3. Wrap `next.config.{js,ts}`

```js
import pinagent from '@pinagent/next/config';

const coreConfig = {
  // ...existing config
};

// pinagent(config, options?) takes an optional second arg:
const wrapped = pinagent(coreConfig, {
  spawnAgent: false,   // 'worktree' | 'inline' | false — see "Configuration" below
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

## 4. Mount `<Pinagent />` in the root layout

```tsx
// app/layout.tsx
import { Pinagent } from '@pinagent/next';

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

## 5. Create the route handler

Create the file **exactly** as below — don't be tempted to one-line the re-export:

```ts
// app/pinagent/[[...slug]]/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { GET, POST, PATCH } from '@pinagent/next/route';
```

Why `dynamic` and `runtime` are inline: Next 16 statically parses route-segment config at build time and refuses to follow re-exports for those fields. If you write `export { dynamic, runtime } from '@pinagent/next/route'` you'll get:

```
Next.js can't recognize the exported `dynamic` field in route. It mustn't be reexported.
```

Why the folder is `pinagent/` not `__pinagent/`: same `_` private-folder rule. The `pinagent(config)` wrapper's rewrite forwards the public URL `/__pinagent/*` (which the widget POSTs to) onto this `/pinagent/*` route.

## 6. Common: gitignore + MCP

Continue with [mcp.md](./mcp.md) for MCP server setup and `.gitignore`.

## Verify

```bash
cd /path/to/target && pnpm dev   # uses the existing dev script
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/__pinagent/widget.js
# expect: 200
```

Then open the browser and confirm:

1. 💬 button bottom-right
2. Inspect any element → DOM has `data-pa-loc="src/Foo.tsx:42:7"`
3. No hydration warnings in DevTools console
4. Submit a comment → file lands at `<project root>/.pinagent/feedback/`

## Widget architecture (so you don't get confused debugging)

The composer (textarea + Submit/Cancel) renders inside an **iframe** mounted from the widget's shadow root. The 💬 FAB and the picker outline are in shadow DOM only. The iframe is needed because focus traps from modal libraries (Radix Dialog, react-focus-lock, etc.) reach across shadow-root boundaries — they cannot reach into an iframe document.

When the developer clicks the textarea: focus moves into the iframe's document, the parent-doc focus moves to the iframe element. Even if the host modal's focus trap fires and refocuses Cancel, keyboard input is still routed by the browser to the iframe (where the actual active element lives).

If you ever need to inspect the composer in DevTools, drill into the iframe element inside `<div id="pinagent-root">` in the parent DOM tree.

## Known gotchas

- **Turbopack first compile is slow.** Expect 30-60s the first time the loader runs — Turbopack recompiles every `.tsx` to add `data-pa-loc`. HMR is fast after that.
- **`color-scheme: dark` on the host page** styles form controls inside the widget with dark browser defaults. The widget IIFE counters this with explicit `color-scheme: light` and explicit backgrounds — no action needed, but if you see a dark textarea, the installed IIFE is stale (bump version and reinstall).
- **CSP `connect-src` blocking the widget's image inlining.** The widget uses `html-to-image.toBlob()` + `createImageBitmap()` + `canvas.toBlob()` — no `fetch()` calls. It also skips cross-origin `<img>` elements before they're inlined (CSP would block those fetches). Cross-origin images appear as blank slots in the captured screenshot. To get them captured, either (a) add the CDN to `connect-src`, or (b) proxy them through a same-origin Next rewrite (like you might do for analytics).
- **Custom middleware (`proxy.ts` in Next 16, `middleware.ts` before that).** `/__pinagent/*` runs through every middleware just like other routes. If your middleware rejects unknown paths, add an exclusion. Most setups passthrough by default and don't need changes.
- **Sherif / monorepo postinstall.** `pnpm add` may roll back due to unrelated workspace lint failures. Use `--ignore-scripts` to skip the postinstall hook on installs of pinagent-only.

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

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

## 5. Common: gitignore + MCP

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
- **Custom middleware (`proxy.ts` in Next 16, `middleware.ts` before that).** `/__pinagent/*` runs through every middleware just like other routes. If your middleware rejects unknown paths, add an exclusion. Most setups passthrough by default and don't need changes.
- **Sherif / monorepo postinstall.** `pnpm add` may roll back due to unrelated workspace lint failures. Use `--ignore-scripts` to skip the postinstall hook on installs of pinagent-only.
- **Stale `@pinagent/*` symlinks from an earlier attempt.** The package is **`@pinagent/next-plugin`** — there is no `@pinagent/next`. If a previous or aborted install left a broken symlink under `node_modules/@pinagent/` (e.g. a dangling `@pinagent/next`), module resolution can fail in confusing ways even after a correct reinstall. `pnpm dlx @pinagent/cli doctor` flags dangling `@pinagent/*` symlinks; remove the broken links and reinstall.

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

When using the dock:

- The route handler uses `export *`, so it re-exports whatever HTTP verbs the installed `@pinagent/next-plugin` build provides — `GET, POST, PATCH`, plus `PUT, DELETE` on builds that ship the dock's Connections/Branches panels (see step 4). Using `export *` keeps the route working across plugin versions; keep `dynamic`/`runtime` inline since Next won't follow re-exports for route-segment config.
- The PR composer needs a GitHub token: set `GITHUB_TOKEN` or `PINAGENT_GITHUB_TOKEN` (tried in that order).
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

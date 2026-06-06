---
name: pinagent-setup
description: Wire Pinagent into a target project so the developer can click (or, on React Native, tap) UI elements, leave comments, and have agents pick them up — either over MCP into the developer's main Claude Code session, or via the Claude Agent SDK as parallel per-comment agents in isolated worktrees. Use when the user asks to "set up pinagent", "install pinagent", "add pinagent to <repo>", or wants the click-to-fix loop in a new app. Detects whether the target is a Vite+React, Next.js, Nuxt (Vue), or React Native / Expo (Metro) app and follows the matching runtime guide.
---

# Pinagent setup

Pinagent is a localhost feedback loop: a build-time plugin tags JSX with `data-pa-loc`, a browser widget lets the developer pick an element and submit a comment + screenshot, and one of several delivery modes hands the comment to an agent — either MCP-into-running-session, or a per-comment Claude Agent SDK run inside an isolated git worktree.

> **Default behavior.** On Submit, both plugins run the Claude Agent SDK against the project and stream the run — text, tool chips, cost/turns — back into the widget pane over WebSocket. A persistent follow-up input sends additional turns (resuming the same session), and `ask_user` prompts render as inline forms the agent waits on. This is the `spawnAgent: 'inline'` default; `'worktree'` runs each submit in an isolated git worktree, and `'off'` / `false` disables per-submit spawn so you drive the loop from your own MCP session instead.

## Detect the runtime

Before doing anything, identify the target project's runtime — the install steps differ.

```bash
# In the target project root:
ls nuxt.config.* 2>/dev/null && echo "NUXT"   # check FIRST — Nuxt runs Vite under the hood
grep -q '@sveltejs/kit' package.json 2>/dev/null && echo "SVELTEKIT"  # also runs Vite; check before VITE
ls vite.config.* 2>/dev/null && echo "VITE"
ls next.config.* 2>/dev/null && echo "NEXT"
ls metro.config.* app.json 2>/dev/null | head -1 && echo "REACT_NATIVE"  # also: "expo"/"react-native" in package.json deps
```

| If you see       | Follow                |
| ---------------- | --------------------- |
| `NUXT`           | [nuxt.md](./nuxt.md)  |
| `SVELTEKIT`      | [sveltekit.md](./sveltekit.md) |
| `VITE`           | [vite.md](./vite.md)  |
| `NEXT`           | [next.md](./next.md)  |
| `REACT_NATIVE` / Expo | [react-native.md](./react-native.md) |
| both / neither   | Ask the user — pinagent supports React on Vite or Next, Vue on Nuxt, and React Native / Expo (Metro). Plain Vue+Vite **and** Svelte+Vite work too (use the [vite.md](./vite.md) guide — `@pinagent/vite-plugin` tags `.vue` SFCs and `.svelte` components as well as JSX). CRA/Remix aren't supported. |

> Both Nuxt and SvelteKit run Vite internally, so check them **before**
> `vite.config.*`. Nuxt's marker is `nuxt.config.*` (use the Nuxt module);
> SvelteKit's is the `@sveltejs/kit` dependency (use the Vite plugin + a small
> SvelteKit hook — see sveltekit.md). A plain Svelte + Vite app (no
> `@sveltejs/kit`) is just the [vite.md](./vite.md) path — it's an SPA with an
> `index.html`, so the widget auto-injects with no hook needed.

> React Native is **tap-to-comment**, not click: no DOM, so no
> `data-pa-loc` and no `<script>` injection. The widget mounts as a
> `<Pinagent/>` component and resolves the tapped view to `file:line` via
> RN's built-in Inspector. The agent backend is identical.

> **Monorepo with more than one app?** The detection above is per-runtime,
> not per-app. In a workspace with several UI apps, **enumerate the
> candidate apps and ask the developer which one** to wire — don't guess or
> wire all of them. Run the detection inside each app dir, and **skip
> backend-only services** (Fastify/Express/Nest, API workers, queue
> consumers): they serve no DOM, so there's nothing to tag, click, or
> screenshot. Pinagent only applies to apps that render a browser UI (or a
> React Native / Expo app).

After the runtime-specific install, **every project needs** the MCP server step: [mcp.md](./mcp.md).

## Quick mental model

```
build-time plugin → tags JSX with data-pa-loc
                  ↓
browser widget     → picks element, captures screenshot, POSTs to /__pinagent/feedback
                  ↓
agent-runner route → writes a row to <project>/.pinagent/db.sqlite + screenshots/<id>.png
                  ↓
@pinagent/mcp     → reads the same .pinagent/db.sqlite, exposes 5 tools to the agent
                  ↓
optional channel  → pushes new feedback into a running `claude` session
```

The Vite plugin and Next adapter share the widget IIFE and storage layout — they're interchangeable on the consumer side. Only the build/dev integration differs. The Nuxt module is a thin wrapper that reuses `@pinagent/vite-plugin` (Nuxt's dev bundler is Vite) and injects the widget into the SSR'd HTML via the app head.

The per-element widget above is on by default. There's also an **optional dock surface** — a project-management UI (Conversations, Changes/diffs, Branches, PRs, Connections, History) enabled with `dock: true` on either plugin. It's off by default; see the runtime guides for how to turn it on, and what extra wiring it needs (the full set of route verbs on Next, plus a GitHub token for the PR composer).

## Where pinagent comes from

The plugins, MCP server, and CLI are published to npm under the `@pinagent/*` scope — `@pinagent/vite-plugin`, `@pinagent/next-plugin`, `@pinagent/nuxt-plugin`, `@pinagent/react-native`, `@pinagent/mcp`, and `@pinagent/cli` (the `pinagent` command: `init`, `mcp`, `transcript`). Install steps use `pnpm add -D` and `pnpm dlx`; nothing references a local checkout, so the skill works in any project.

## Common pitfalls (skim before you start)

- **Verify the wiring with `pinagent doctor` instead of probing by hand.** After setup, run `pnpm dlx @pinagent/cli doctor` (add `--dir apps/<app>` in a monorepo). It's read-only and checks the whole chain: the plugin and its subpath exports resolve, the config is wrapped, `<Pinagent />` is mounted and the route handler is correct (Next), `.pinagent` is gitignored, `.mcp.json` registers the server and any `PINAGENT_PROJECT_ROOT` points at a real directory, and there are no dangling `@pinagent/*` symlinks from an aborted install. Exits non-zero if anything's wrong.
- **Don't put `.pinagent/` in version control.** Always add it to `.gitignore` of the target repo (monorepo root, not just the app). This covers `.pinagent/db.sqlite` (+ `-wal`/`-shm`), `.pinagent/screenshots/`, `.pinagent/logs/`, AND `.pinagent/worktrees/` (for worktree mode).
- **In a monorepo, register the MCP server at the repo ROOT, not the app.** Run `claude` from the monorepo root with one project-scoped `.mcp.json` there, so a single agent session can edit the app *and* the shared packages a fix touches. Storage still lives at `<wherever Next/Vite runs from>/.pinagent/`, so point `PINAGENT_PROJECT_ROOT` at that app dir. See [mcp.md](./mcp.md) §2.
- **Hard-refresh the browser** after upgrading the plugin — the widget IIFE is cached. (Chrome DevTools → Network tab → "Disable cache" while DevTools is open helps during development.)
- **Auto mode blocks MCP tools by default.** The agent will say "tools were denied" unless the project's `.claude/settings.local.json` allow-lists `mcp__pinagent__*`. Use the `/permissions` slash command inside Claude Code to set this up.
- **Auth for SDK-backed spawn modes: OAuth (subscription) by default, env key only if you want to bill the API account.** The SDK bundles the Claude Code binary and respects the same auth as the CLI. If the developer is logged in (`claude login`, or via the Claude desktop app), spawn modes use that OAuth session — billed against the subscription. If `ANTHROPIC_API_KEY` is exported, the binary prefers it and bills the API account instead. Bedrock/Vertex/Foundry work too via `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` env vars. Channel mode is unaffected (it pushes into the developer's existing `claude` session).
- **The MCP server must be running in a session for channel mode.** Launch with `--dangerously-load-development-channels server:pinagent`. Otherwise it's pull-mode (the user asks "what feedback is pending?") or SDK-spawn mode (each submit runs a per-feedback SDK agent in the background).
- **SDK agents die with the dev server.** SDK-spawned agents run in-process. Restarting the dev server mid-fix kills any in-flight agent — the log file will end mid-stream. The feedback record stays `pending` so the next agent run picks it up.
- **The composer is rendered in an iframe**, not just shadow DOM. This is intentional — iframes have their own focus context so modal focus traps (Radix Dialog, react-focus-lock, etc.) can't reach in. If you're debugging the composer in DevTools, drill into the iframe element.
- **CSP `connect-src` blocking the widget WebSocket.** If the app sends its own Content-Security-Policy, the widget's dev WebSocket (`ws://127.0.0.1:<PINAGENT_WS_PORT>/__pinagent/ws`, default port 53636) and its `http://127.0.0.1:*` feedback POSTs must be allow-listed in `connect-src`. **`localhost` and `127.0.0.1` are different CSP origins** — allow-listing one does not cover the other, so include **both** loopback forms for dev: `connect-src ... ws://localhost:* wss://localhost:* http://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:*`. Symptom: the widget loads but the inline streaming pane never connects, with a `connect-src` violation in the console. The agent still runs server-side, so fixes appear to land while the pane stays blank. On Next this CSP is usually emitted from middleware/`proxy.ts`, which is compiled at startup — **restart the dev server** (not just hard-refresh) after editing the CSP, then hard-refresh.
- **Existing Next middleware/proxy with a catch-all matcher shadows pinagent's rewrite (Next only).** Middleware runs **before** `next.config` rewrites, so a broad `matcher` (next-intl, NextAuth/Clerk, geo/redirect middleware) intercepts `/__pinagent/*` and mangles the path before pinagent's rewrite resolves — **every endpoint 404s** and the loop breaks silently, even with passthrough middleware. Whenever the app has a `middleware.{ts,js}` / `proxy.{ts,js}` (in `src/` if routes live in `src/app`), exclude `__pinagent` and `pinagent` from its matcher. Symptom: `curl .../__pinagent/branches` 404s while `widget.js` 200s. Restart the dev server after editing (no HMR). Full per-syntax patterns in [next.md](./next.md) step 5.
- **Framing headers (`X-Frame-Options` / CSP `frame-ancestors`) blocking the dock iframe — `dock: true` only.** The dock is a **same-origin iframe** (`/__pinagent/dock/*`), not just shadow DOM, so it inherits the app's security headers. `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` each **independently** block it — fixing one still leaves the frame dead. Symptom: the dock area is blank / shows a broken-image icon and the console logs `Framing '...' violates ... directive: "frame-ancestors 'none'". The request has been blocked.`; the per-element widget and its WebSocket still work, so pinagent looks loaded but the dock is dead. Relax **both** in dev: `X-Frame-Options: SAMEORIGIN` (no value permits same-origin-only beyond `SAMEORIGIN`) and `frame-ancestors 'self'` (plus `frame-src 'self' http://localhost:*` if your CSP sets `frame-src`); keep production locked (`DENY` / `'none'`). This is the framing sibling of the `connect-src` exception above — and, like it, the headers come from middleware (`proxy.ts`/`middleware.ts`) that's compiled at startup, so **restart the dev server**, then hard-refresh. Full pattern + table in [next.md](./next.md).

## Environment variables (handy reference)

| Var | Purpose | Read by |
| --- | --- | --- |
| `PINAGENT_PROJECT_ROOT` | Absolute path to project root (where `.pinagent/` lives) | MCP server, route handler, agent spawn |
| `PINAGENT_SPAWN_AGENT` | `worktree` / `inline` / unset — agent spawn mode for the Next adapter | Next route handler |
| `PINAGENT_AGENT_PERMISSION_MODE` | `permissionMode` passed to the Agent SDK (default `acceptEdits`) | Next + Vite agent spawners |
| `ANTHROPIC_API_KEY` | Optional API key. If set, the SDK bills the API account instead of the OAuth subscription. Unset to use `claude login` credentials. | Next + Vite agent spawners |
| `PINAGENT_WS_PORT` | Port the dev-side WebSocket server binds (Next only). Widget connects to this port. | `53636` |
| `PINAGENT_EDITOR` | Editor command for the "click file:line:col to open" feature | Route handler `/open` endpoint |
| `EDITOR` / `VISUAL` | Fallback for `PINAGENT_EDITOR` (standard *nix conventions) | Route handler `/open` endpoint |
| `GITHUB_TOKEN` / `PINAGENT_GITHUB_TOKEN` | Token used by the dock's PR composer to open PRs (only needed with `dock: true`). `GITHUB_TOKEN` is tried first. | Agent-runner PR composer |

Set these in `.mcp.json`'s `env` block (for the MCP server) or in your shell where you run `pnpm dev` (for the route handler / spawner). The plugin's `pinagent(config, { spawnAgent: ... })` option sets `PINAGENT_SPAWN_AGENT` for you.

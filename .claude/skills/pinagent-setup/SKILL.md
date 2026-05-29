---
name: pinagent-setup
description: Wire Pinagent into a target project so the developer can click (or, on React Native, tap) UI elements, leave comments, and have agents pick them up — either over MCP into the developer's main Claude Code session, or via the Claude Agent SDK as parallel per-comment agents in isolated worktrees. Use when the user asks to "set up pinagent", "install pinagent", "add pinagent to <repo>", or wants the click-to-fix loop in a new app. Detects whether the target is a Vite+React, Next.js, or React Native / Expo (Metro) app and follows the matching runtime guide.
---

# Pinagent setup

Pinagent is a localhost feedback loop: a build-time plugin tags JSX with `data-pa-loc`, a browser widget lets the developer pick an element and submit a comment + screenshot, and one of several delivery modes hands the comment to an agent — either MCP-into-running-session, or a per-comment Claude Agent SDK run inside an isolated git worktree.

> **Default behavior.** On Submit, both plugins run the Claude Agent SDK against the project and stream the run — text, tool chips, cost/turns — back into the widget pane over WebSocket. A persistent follow-up input sends additional turns (resuming the same session), and `ask_user` prompts render as inline forms the agent waits on. This is the `spawnAgent: 'inline'` default; `'worktree'` runs each submit in an isolated git worktree, and `'off'` / `false` disables per-submit spawn so you drive the loop from your own MCP session instead.

## Detect the runtime

Before doing anything, identify the target project's runtime — the install steps differ.

```bash
# In the target project root:
ls vite.config.* 2>/dev/null && echo "VITE"
ls next.config.* 2>/dev/null && echo "NEXT"
ls metro.config.* app.json 2>/dev/null | head -1 && echo "REACT_NATIVE"  # also: "expo"/"react-native" in package.json deps
```

| If you see       | Follow                |
| ---------------- | --------------------- |
| `VITE`           | [vite.md](./vite.md)  |
| `NEXT`           | [next.md](./next.md)  |
| `REACT_NATIVE` / Expo | [react-native.md](./react-native.md) |
| both / neither   | Ask the user — pinagent supports React on Vite or Next, and React Native / Expo (Metro). Vue/Svelte/CRA/Remix aren't supported. |

> React Native is **tap-to-comment**, not click: no DOM, so no
> `data-pa-loc` and no `<script>` injection. The widget mounts as a
> `<Pinagent/>` component and resolves the tapped view to `file:line` via
> RN's built-in Inspector. The agent backend is identical.

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

The Vite plugin and Next adapter share the widget IIFE and storage layout — they're interchangeable on the consumer side. Only the build/dev integration differs.

The per-element widget above is on by default. There's also an **optional dock surface** — a project-management UI (Conversations, Changes/diffs, Branches, PRs, Connections, History) enabled with `dock: true` on either plugin. It's off by default; see the runtime guides for how to turn it on, and what extra wiring it needs (the full set of route verbs on Next, plus a GitHub token for the PR composer).

## Where pinagent comes from

The plugins and MCP server are published to npm under the `@pinagent/*` scope — `@pinagent/vite-plugin`, `@pinagent/next-plugin`, `@pinagent/react-native`, and `@pinagent/mcp`. Install steps use `pnpm add -D` and `pnpm dlx`; nothing references a local checkout, so the skill works in any project.

## Common pitfalls (skim before you start)

- **Don't put `.pinagent/` in version control.** Always add it to `.gitignore` of the target repo (monorepo root, not just the app). This covers `.pinagent/db.sqlite` (+ `-wal`/`-shm`), `.pinagent/screenshots/`, `.pinagent/logs/`, AND `.pinagent/worktrees/` (for worktree mode).
- **Project root matters in monorepos.** Storage lives at `<wherever Next/Vite runs from>/.pinagent/`. The MCP server must point at that same directory via `PINAGENT_PROJECT_ROOT`.
- **Hard-refresh the browser** after upgrading the plugin — the widget IIFE is cached. (Chrome DevTools → Network tab → "Disable cache" while DevTools is open helps during development.)
- **Auto mode blocks MCP tools by default.** The agent will say "tools were denied" unless the project's `.claude/settings.local.json` allow-lists `mcp__pinagent__*`. Use the `/permissions` slash command inside Claude Code to set this up.
- **Auth for SDK-backed spawn modes: OAuth (subscription) by default, env key only if you want to bill the API account.** The SDK bundles the Claude Code binary and respects the same auth as the CLI. If the developer is logged in (`claude login`, or via the Claude desktop app), spawn modes use that OAuth session — billed against the subscription. If `ANTHROPIC_API_KEY` is exported, the binary prefers it and bills the API account instead. Bedrock/Vertex/Foundry work too via `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` env vars. Channel mode is unaffected (it pushes into the developer's existing `claude` session).
- **The MCP server must be running in a session for channel mode.** Launch with `--dangerously-load-development-channels server:pinagent`. Otherwise it's pull-mode (the user asks "what feedback is pending?") or SDK-spawn mode (each submit runs a per-feedback SDK agent in the background).
- **SDK agents die with the dev server.** SDK-spawned agents run in-process. Restarting the dev server mid-fix kills any in-flight agent — the log file will end mid-stream. The feedback record stays `pending` so the next agent run picks it up.
- **The composer is rendered in an iframe**, not just shadow DOM. This is intentional — iframes have their own focus context so modal focus traps (Radix Dialog, react-focus-lock, etc.) can't reach in. If you're debugging the composer in DevTools, drill into the iframe element.

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

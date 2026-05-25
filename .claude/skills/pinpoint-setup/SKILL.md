---
name: pinpoint-setup
description: Wire Pinpoint into a target project so the developer can click UI elements, leave comments, and have agents pick them up — either over MCP into the developer's main Claude Code session, or via the Claude Agent SDK as parallel per-comment agents in isolated worktrees. Use when the user asks to "set up pinpoint", "install pinpoint", "add pinpoint to <repo>", or wants the click-to-fix loop in a new app. Detects whether the target is a Vite+React or Next.js app and follows the matching runtime guide.
---

# Pinpoint setup

Pinpoint is a localhost feedback loop: a build-time plugin tags JSX with `data-pp-loc`, a browser widget lets the developer pick an element and submit a comment + screenshot, and one of several delivery modes hands the comment to an agent — either MCP-into-running-session, or a per-comment Claude Agent SDK run inside an isolated git worktree.

> **Architecture status.** v1 (the shipped base loop) and v2 (the persistent chat-surface-per-widget redesign covered by `pinpoint-v2-plan.md`) coexist during the migration. Install steps are stable across both. What's shipped so far:
>
> - **Phase A (done).** Per-comment agents and the Vite auto-trigger run the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) in-process. Log files contain SDK-rendered transcripts; each run's `sessionId` is persisted on the feedback record.
> - **Phase B (done, WebSocket).** Per-feedback in-memory event bus (`packages/next/src/event-bus.ts`) fans SDK events to subscribers. A dedicated WebSocket server (`packages/next/src/ws-server.ts`, default port 53636 — env override `PINPOINT_WS_PORT`) handles all widget ↔ dev bidirectional traffic: event subscriptions, follow-up `user_message`s, `ask_response` replies, and `interrupt`. The widget bundle's prelude inlines the WS URL at serve time.
> - **Phase E (done, bi-directional).** The widget composer iframe swaps into a streaming pane on Submit and renders text + tool chips + final cost/turns inline. Persistent follow-up input lets you send additional turns over WS (resumes the prior session). `ask_user` events render as inline forms with optional one-click options; submitting POSTs an `ask_response` back over WS and the agent continues.
> - **Phase F (done).** `ask_user` custom SDK tool (`packages/next/src/ask-user.ts`) registered on every spawn. Per-process pending-asks map with 10-min TTL. System prompt instructs the agent to prefer asking over guessing.
> - **V2 default in Next.** `spawnAgent` defaults to `'inline'` so the streaming-into-widget flow is on out of the box. Worktree mode is opt-in (`spawnAgent: 'worktree'`); `'off'` / `false` disables per-submit spawn entirely.
> - **Not yet shipped (Phases C/D/F/G/H/I/J).** SQLite layer, host-script + iframe-per-widget architecture, `ask_user` clarification, HMR re-anchoring, Land/Discard worktree lifecycle, post-edit verification, per-turn process spawn.

## Detect the runtime

Before doing anything, identify the target project's runtime — the install steps differ.

```bash
# In the target project root:
ls vite.config.* 2>/dev/null && echo "VITE"
ls next.config.* 2>/dev/null && echo "NEXT"
```

| If you see       | Follow                |
| ---------------- | --------------------- |
| `VITE`           | [vite.md](./vite.md)  |
| `NEXT`           | [next.md](./next.md)  |
| both / neither   | Ask the user — pinpoint v1 only supports React on Vite or Next. Vue/Svelte/CRA/Remix aren't supported. |

After the runtime-specific install, **every project needs** the MCP server step: [mcp.md](./mcp.md).

## Quick mental model

```
build-time plugin → tags JSX with data-pp-loc
                  ↓
browser widget     → picks element, captures screenshot, POSTs to /__pinpoint/feedback
                  ↓
dev-server route   → writes <project>/.pinpoint/feedback/<id>.json + screenshot.png
                  ↓
@pinpoint/mcp     → reads .pinpoint/, exposes 4 tools to the agent
                  ↓
optional channel  → pushes new feedback into a running `claude` session
```

The Vite plugin and Next adapter share the widget IIFE and storage layout — they're interchangeable on the consumer side. Only the build/dev integration differs.

## Where pinpoint itself lives

The pinpoint packages are at `/Users/jacksonmalloy/code/pinpoint/` (not on npm yet). All install steps reference local tarballs or absolute paths to that directory.

If pinpoint moves, every consumer's `.mcp.json` (absolute path to `@pinpoint/mcp/dist/index.js`) and `package.json` (file: tarball path) needs updating.

## Common pitfalls (skim before you start)

- **Don't put `.pinpoint/` in version control.** Always add it to `.gitignore` of the target repo (monorepo root, not just the app). This includes `.pinpoint/feedback/`, `.pinpoint/screenshots/`, `.pinpoint/logs/`, AND `.pinpoint/worktrees/` (for worktree mode).
- **Project root matters in monorepos.** Storage lives at `<wherever Next/Vite runs from>/.pinpoint/`. The MCP server must point at that same directory via `PINPOINT_PROJECT_ROOT`.
- **Hard-refresh the browser** after rebuilding the widget — the IIFE is cached. (Chrome DevTools → Network tab → "Disable cache" while DevTools is open helps during development.)
- **Bump the version when re-packing.** `pnpm pack` uses the version in `package.json`; if you re-pack without bumping, pnpm caches by filename and consumer installs won't pick up your changes. Bump even for tiny fixes.
- **Auto mode blocks MCP tools by default.** The agent will say "tools were denied" unless the project's `.claude/settings.local.json` allow-lists `mcp__pinpoint__*`. Use the `/permissions` slash command inside Claude Code to set this up.
- **Auth for SDK-backed spawn modes: OAuth (subscription) by default, env key only if you want to bill the API account.** The SDK bundles the Claude Code binary and respects the same auth as the CLI. If the developer is logged in (`claude login`, or via the Claude desktop app), spawn modes use that OAuth session — billed against the subscription. If `ANTHROPIC_API_KEY` is exported, the binary prefers it and bills the API account instead. Bedrock/Vertex/Foundry work too via `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` env vars. Channel mode is unaffected (it pushes into the developer's existing `claude` session).
- **The MCP server must be running in a session for channel mode.** Launch with `--dangerously-load-development-channels server:pinpoint`. Otherwise it's pull-mode (the user asks "what feedback is pending?") or SDK-spawn mode (each submit runs a per-feedback SDK agent in the background).
- **SDK agents die with the dev server.** Unlike the v1 detached `claude -p` processes, SDK-spawned agents run in-process. Restarting the dev server mid-fix kills any in-flight agent — the log file will end mid-stream. The feedback record stays `pending` so the next agent run picks it up. (This will become a non-issue once Phase H lands per-turn process spawn from the v2 plan.)
- **The composer is rendered in an iframe**, not just shadow DOM. This is intentional — iframes have their own focus context so modal focus traps (Radix Dialog, react-focus-lock, etc.) can't reach in. If you're debugging the composer in DevTools, drill into the iframe element.

## Environment variables (handy reference)

| Var | Purpose | Read by |
| --- | --- | --- |
| `PINPOINT_PROJECT_ROOT` | Absolute path to project root (where `.pinpoint/` lives) | MCP server, route handler, agent spawn |
| `PINPOINT_SPAWN_AGENT` | `worktree` / `inline` / unset — agent spawn mode for the Next adapter | Next route handler |
| `PINPOINT_AGENT_PERMISSION_MODE` | `permissionMode` passed to the Agent SDK (default `acceptEdits`) | Next + Vite agent spawners |
| `ANTHROPIC_API_KEY` | Optional API key. If set, the SDK bills the API account instead of the OAuth subscription. Unset to use `claude login` credentials. | Next + Vite agent spawners |
| `PINPOINT_WS_PORT` | Port the dev-side WebSocket server binds (Next only). Widget connects to this port. | `53636` |
| `PINPOINT_EDITOR` | Editor command for the "click file:line:col to open" feature | Route handler `/open` endpoint |
| `EDITOR` / `VISUAL` | Fallback for `PINPOINT_EDITOR` (standard *nix conventions) | Route handler `/open` endpoint |

Set these in `.mcp.json`'s `env` block (for the MCP server) or in your shell where you run `pnpm dev` (for the route handler / spawner). The plugin's `pinpoint(config, { spawnAgent: ... })` option sets `PINPOINT_SPAWN_AGENT` for you.

---
name: pinpoint-setup
description: Wire Pinpoint into a target project so the developer can click UI elements, leave comments, and have the running Claude Code session pick them up over MCP. Use when the user asks to "set up pinpoint", "install pinpoint", "add pinpoint to <repo>", or wants the click-to-fix loop in a new app. Detects whether the target is a Vite+React or Next.js app and follows the matching runtime guide.
---

# Pinpoint setup

Pinpoint is a localhost-only feedback loop: a build-time plugin tags JSX with `data-pp-loc`, a browser widget lets the developer pick an element and submit a comment + screenshot, and an MCP server (optionally with a channel) surfaces those comments to the coding agent.

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

- **Don't put `.pinpoint/` in version control.** Always add it to `.gitignore` of the target repo (monorepo root, not just the app).
- **Project root matters in monorepos.** Storage lives at `<wherever Next/Vite runs from>/.pinpoint/`. The MCP server must point at that same directory via `PINPOINT_PROJECT_ROOT`.
- **Hard-refresh the browser** after rebuilding the widget — the IIFE is cached.
- **Auto mode blocks MCP tools by default.** The agent will say "tools were denied" unless the project's `.claude/settings.local.json` allow-lists `mcp__pinpoint__*`.
- **The MCP server must be running in a session.** If you want the channel-push experience, launch with `--dangerously-load-development-channels server:pinpoint`. Otherwise it's pull-mode (the user asks "what feedback is pending?").

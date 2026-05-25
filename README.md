# Pinpoint

Click-to-fix loop for local Vite + React development.

While running `vite dev`, click a UI element in the browser, leave a comment, and your coding agent picks it up over MCP with file:line context and a screenshot.

## Packages

- `@pinpoint/vite-plugin` — Vite plugin: tags JSX with source locations, injects the widget, serves middleware to capture feedback.
- `@pinpoint/widget` — Browser UI (shadow-root chat button → pick mode → composer). Built as IIFE and embedded in `vite-plugin`.
- `@pinpoint/mcp` — stdio MCP server that reads `.pinpoint/feedback/` and exposes tools to your coding agent.

## Quick start

```bash
pnpm install
pnpm build
pnpm example  # runs examples/react-vite
```

Then open <http://localhost:5173>, click the 💬 button, pick something, and submit. See `.pinpoint/feedback/*.json`.

## Spec

See the original Pinpoint MVP technical specification in chat history. Notable invariants:

- Localhost only. Binds to `127.0.0.1`.
- No auth. Trust boundary is the developer's own machine.
- File-system is the message bus between Vite and MCP.
- React + Vite only in v1.

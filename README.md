# Pinagent

Click-to-fix loop for local Vite + React development.

While running `vite dev`, click a UI element in the browser, leave a comment, and your coding agent picks it up over MCP with file:line context and a screenshot.

## Packages

- `@pinagent/vite-plugin` — Vite plugin: tags JSX with source locations, injects the widget, serves middleware to capture feedback.
- `@pinagent/widget` — Browser UI (shadow-root chat button → pick mode → composer). Built as IIFE and embedded in `vite-plugin`.
- `@pinagent/mcp` — stdio MCP server that reads `.pinagent/feedback/` and exposes tools to your coding agent.

## Quick start

```bash
pnpm install
pnpm build
pnpm example  # runs examples/react-vite
```

Then open <http://localhost:5173>, click the 💬 button, pick something, and submit. See `.pinagent/feedback/*.json`.

## Spec

See the original Pinagent MVP technical specification in chat history. Notable invariants:

- Localhost only. Binds to `127.0.0.1`.
- No auth. Trust boundary is the developer's own machine.
- File-system is the message bus between Vite and MCP.
- React + Vite only in v1.

## Licensing

This repository contains two licenses:

- **Apache License 2.0** — covers `packages/`, `apps/cli/`, and `examples/`.
  Free for any use, commercial or otherwise. See [LICENSE](./LICENSE).
- **Elastic License v2** — covers `ee/` and `apps/cloud/`. Source-available;
  may be used for internal purposes but may not be provided as a hosted service
  to third parties. See [ee/LICENSE](./ee/LICENSE).

The rule of thumb: if it runs on the developer's own machine, it's Apache-2.0.
If it runs as a hosted multi-tenant service, it's Elastic License v2.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). External contributions are welcome
against `packages/*` and `apps/cli/`; we do not accept external PRs against
`ee/*` or `apps/cloud/`.

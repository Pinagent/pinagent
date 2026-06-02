---
'@pinagent/cli': patch
---

`pinagent doctor` now nudges toward registering the MCP server at the monorepo root: it detects the workspace root (pnpm-workspace.yaml / `workspaces` field / lerna.json) and warns when `.mcp.json` is buried inside an app instead, and points the "no .mcp.json found" hint at the repo root in a monorepo.

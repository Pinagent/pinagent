---
"@pinagent/cli": minor
---

`pinagent mcp` can serve every app in a monorepo from one process via `PINAGENT_PROJECT_ROOTS` / `PINAGENT_WORKSPACE_ROOT` (documented in `pinagent --help`). `pinagent doctor` validates those variables (every listed root exists, the checked app is served) and warns when several per-app `pinagent-*` MCP servers are registered where one multi-root server would do.

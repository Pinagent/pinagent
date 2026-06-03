---
"@pinagent/mcp": patch
---

Set a SQLite `busy_timeout` on the MCP server's DB connection so a `resolve_feedback` write waits and retries instead of throwing `SQLITE_BUSY` when it races the dev server's event-bus writes (which would otherwise silently drop the resolution).

---
"@pinagent/mcp": minor
---

Serve several project roots from one MCP server. A monorepo with several wired apps (each with its own `.pinagent/db.sqlite`) no longer needs one `pinagent-<app>` server per app: set `PINAGENT_PROJECT_ROOTS` (path-delimiter-separated) and/or `PINAGENT_WORKSPACE_ROOT` (bounded scan for `.pinagent/` dirs, re-run so new apps appear without a restart) on a single `pinagent` server. `list_pending_feedback` merges every project and labels each item with `project`, `project_root` and `abs_file`; `get_feedback`, `resolve_feedback` and `get_conversation_transcript` route by id to the DB that holds it (clean not-found / ambiguous errors); `get_source_context` and `create_pull_request` take a `project` argument; channel events carry `project`, `root` and `absFile`, and the server instructions explain them. With neither variable set, `PINAGENT_PROJECT_ROOT` / walk-up resolution, tool schemas, output and channel events are unchanged.

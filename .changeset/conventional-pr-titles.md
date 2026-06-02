---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/mcp": patch
---

Standardize generated PR titles + commit messages as Conventional Commits.

The dashboard's "Create PR" summarizer now produces titles in
`type(scope): summary` form (e.g. `feat(dock): …`, `fix(widget): …`),
choosing the scope from the changed file paths — matching the repo's commit
convention. The same spec drives the inline commit-message generator (so the
auto-commit subject is consistent) and the `create_pull_request` MCP tool's
title guidance for the connected agent.

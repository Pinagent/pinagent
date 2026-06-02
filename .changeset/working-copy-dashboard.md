---
"@pinagent/widget-dock": minor
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/mcp": minor
"pinagent-vscode": minor
---

Redesign the dock dashboard around the working branch's git changes.

The Overview now leads with a working-changes hero for the branch the
dev-server is on: changed files (with per-file open-in-VSCode links), +/−
stats, ahead/behind the remote, and a state-aware primary action — **Create
PR** (an inline agent summarizes the diff and opens a PR via the configured
GitHub token), which becomes **Push changes** when local commits are ahead
of the remote and **View PR** once it's up to date. An "Open in VSCode"
button focuses the Source Control view via a new `view-changes` extension
command. The same PR core is exposed as a `create_pull_request` MCP tool, so
a connected Claude Code session can open the PR after summarizing the diff
itself.

New dev-server endpoints back this: `GET /__pinagent/working-copy`,
`POST /__pinagent/working-copy/pr`, and `POST /__pinagent/working-copy/push`
(mirrored across the Vite and Next plugins).

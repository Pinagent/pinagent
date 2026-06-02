---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/mcp": patch
---

Fix "project root is not a git repository" when opening a PR from a subdirectory or linked worktree.

`openHostBranchPr` / `pushHostBranch` (the dashboard's Create PR / Push
actions) and `composePullRequest` guarded on `existsSync(projectRoot/.git)`,
which is false when the dev server runs from a subdirectory of the repo (e.g.
an example app) or a linked worktree (where `.git` is a file at the worktree
root, absent in subdirs). They now detect the repo with
`git rev-parse --is-inside-work-tree` (a shared `isInsideWorkTree` helper),
matching the working-copy status reader. The same fix applies to the
`create_pull_request` MCP tool.

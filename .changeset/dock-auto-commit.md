---
"@pinagent/widget-dock": minor
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/mcp": minor
---

Auto-commit uncommitted changes when opening a PR or pushing from the dashboard.

Create PR / Push previously only ran `git push`, so a PR opened from a dirty
working tree silently omitted the uncommitted edits the dashboard was showing.
Both actions now `git add -A` and commit those changes first (with an
agent-generated message) so the PR actually contains them:

- **Create PR** commits the working changes using the generated PR title as
  the commit message, then pushes + opens the PR.
- **Push changes** generates a commit message for the uncommitted batch
  (inline agent), commits, then pushes. The button now also lights up on
  uncommitted edits (not just commits-ahead-of-remote).
- The `create_pull_request` MCP tool gains an optional `commit_message`; when
  the tree is dirty the connected agent supplies it and the tool commits
  before pushing.

Staging is `git add -A` (everything the dashboard lists); committing is fully
automatic — no extra clicks.

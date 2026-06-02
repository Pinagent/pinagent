---
"@pinagent/widget-dock": minor
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/mcp": minor
---

Actually open the remote PR on "Create PR" via the `gh` CLI, and open it in the browser.

Previously Create PR only opened a real GitHub PR when a token was configured
(a dock-stored secret or `GITHUB_TOKEN`); developers authed only through the
`gh` CLI just got a "branch pushed, open the PR yourself" compare link, and the
button never flipped to **View PR** (no PR was recorded).

`openPrOnGitHub` now falls back to **`gh pr create`** when no Octokit token is
present (or the API call fails) — using the developer's existing `gh auth`, the
way Claude Code opens PRs. The opened PR is recorded, so the dashboard's button
switches to **View PR** (which opens the GitHub URL). Create PR also now opens
the new PR in the browser on success. The `create_pull_request` MCP tool gets
the same `gh` fallback.

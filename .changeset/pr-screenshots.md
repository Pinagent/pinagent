---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/mcp": minor
---

Embed feedback screenshots in pull requests. When a PR is opened for feedback that has a screenshot, the PNG is committed onto the PR branch under `.pinagent/pr-assets/` and referenced from the PR body via its `?raw=true` blob URL — so the review shows the UI the developer actually clicked. The multi-conversation compose flow attaches every selected conversation's screenshot; the host-branch flow (dock "Create PR" and the MCP `create_pull_request` tool) attaches screenshots for any feedback whose resolution commit lands on the branch. GitHub-only and best-effort: it never blocks the PR if hosting the image fails.

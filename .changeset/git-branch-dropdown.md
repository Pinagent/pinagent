---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Add a `GET /__pinagent/git-branches` endpoint listing the repo's real git
branches (local heads + origin remotes, normalized and de-duplicated). Feeds the
PR composer's base-branch field, which now offers those branches as a dropdown
while staying free-text so you can still target a branch git doesn't know yet.

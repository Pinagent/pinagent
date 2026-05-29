---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Add a `POST /__pinagent/prs/refresh` endpoint that reconciles each recorded pull
request's state against GitHub (open → merged / closed / draft) and returns the
updated list. Backs the new "Refresh" button in the dock's PRs view, which until
now showed whatever state was known when the PR was opened. Reuses the compose
flow's GitHub token resolution and origin-remote detection; a no-op when no token
or non-GitHub remote is configured.

---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Refresh the PR description when pushing follow-up commits.

"Push changes" previously committed + pushed but left the PR body frozen at
whatever Create PR wrote. After a successful push, the dashboard now
regenerates the description from the full branch diff (the same inline
summarizer) and updates the open PR on GitHub — via Octokit when a token is
set, otherwise `gh pr edit` — and mirrors it into the recorded PR row. The
update is best-effort and never fails the push.

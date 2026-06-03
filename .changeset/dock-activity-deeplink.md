---
"@pinagent/widget-dock": minor
---

Activity feed: `pr_created` rows now deep-link into the PRs tab.

Clicking a "PR #N opened" row in the History → Activity feed (or the
Overview activity strip) now navigates to the in-dock PRs tab and scrolls
to + briefly highlights that PR — where its reconciled state and GitHub
link live — instead of only offering a buried external "open on GitHub"
link. Rows without a recorded PR number keep the inline GitHub link.

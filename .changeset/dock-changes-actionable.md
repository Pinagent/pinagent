---
"@pinagent/widget-dock": minor
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Changes tab: open changed files in the editor + keep expanded diffs live.

Each file header in an expanded Changes diff is now a button that opens that
file in VSCode — at the **agent's edited version** in the worktree, not the
workspace's pre-change copy (the diff endpoint now returns the worktree's
absolute path; the link shows only when the Pinagent extension is present).
Expanded diffs also refetch on `conversations_changed`, so a diff you're
viewing stays current as the agent commits more, instead of going stale.

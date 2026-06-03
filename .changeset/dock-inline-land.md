---
"@pinagent/widget-dock": minor
---

Conversations list: inline Land for ready worktrees.

A worktree-mode conversation whose worktree is ready now has a hover-
revealed "Land" button right in the list, next to quick-archive — one
click merges the agent's branch into the branch you're on, no detail-view
detour. Only shown for landable (`active`) worktrees; inline-mode rows
never show it (there's nothing to merge). Non-destructive, so no confirm —
the live subscription flips the row to `landed` on success; a merge
conflict leaves it ready, where you open the detail view to resolve.

Threads the conversation's `worktreeState` through the list-row shape
(the server already sends it; it was only used to derive status before).

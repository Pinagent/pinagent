---
"@pinagent/widget-dock": minor
---

Branches tab: live worktree state + honest unmanaged-row action.

The branch list now refetches on a visibility-scoped interval (paused
when the dock is hidden), so a worktree's disk usage and dirty /
behind-base state stay current as an agent edits in it — previously the
list only updated on a conversation event or a prune, leaving `diskMb`
and the state pill stale in between. Unmanaged worktrees (no linked
conversation) now show a plain "Unmanaged" label instead of a
permanently-disabled trash button that read as broken.

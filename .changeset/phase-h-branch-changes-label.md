---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Phase H finishing touch: surface the branch name and uncommitted-files
count in the widget's lifecycle row, matching the v2 plan spec
`pinagent/<id> · 3 changes · [Land] [Discard]`.

Server (`@pinagent/agent-runner`) adds `countWorktreeChanges(worktreePath)`
and includes the result as `changesCount` on `worktree_state` broadcasts
emitted from the subscribe path. The widget uses it (alongside the
`pinagent/<feedbackId>` branch name, which is deterministic) to render
labels like `pinagent/abc123def · 3 changes` for `active`, and
`Old worktree · pinagent/abc123def · 3 changes — review or discard` for
`ttl_warning`. When the count is unknown (worktree gone, git failure)
the count is omitted rather than guessed.

Wire format change: `ServerMessage` of type `worktree_state` gains an
optional `changesCount?: number` field. Backwards-compatible — older
widgets/servers ignore the unknown field.

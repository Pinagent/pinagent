---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/mcp": patch
"@pinagent/widget-dock": patch
---

Stop leaking pinagent's data dir into the dashboard/PRs, and handle detached HEAD.

- **Self-ignore `.pinagent/`.** `getDb` now writes `.pinagent/.gitignore` (`*`)
  on first open, so git never sees the SQLite DB / screenshots / worktrees —
  regardless of whether the host project gitignored `.pinagent`. Without it,
  a project that hadn't gitignored `.pinagent` showed `db.sqlite` (+ `-wal`/`-shm`)
  as untracked changes in the dashboard and `git add -A` (Create PR / Push)
  committed them into the user's PR. `getWorkingCopyStatus` also defensively
  drops `.pinagent/*` from its untracked list (covers the first-request race).
- **Detached HEAD.** The dashboard now shows a disabled "Create PR · Detached
  HEAD" instead of an enabled button that errored on click (e.g. a
  `git worktree add --detach`).

Found via a worktree audit; the core worktree flows (branch resolution,
commit-before-push, slug-collision suffix) were already correct.

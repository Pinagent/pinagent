---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/mcp": patch
---

Fix Create PR / Push committing nested git repos as submodule gitlinks.

The auto-commit step ran `git add -A`, which records any nested git repository
in the tree — linked worktrees under `.claude/worktrees/`, vendored repos, an
un-init'd submodule — as a gitlink ("Subproject commit …"). Opening a PR from
a repo that contained other git checkouts spammed it with dozens of bogus
`.claude/worktrees/*` subproject entries.

`commitWorkingChanges` now unstages every newly-added gitlink (mode 160000,
status A) after `git add -A` and before committing, so only real file changes
land in the commit. Intentionally-tracked submodule pointer updates are left
alone, and a commit whose only "changes" were embedded repos cleanly no-ops.

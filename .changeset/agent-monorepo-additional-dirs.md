---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/react-native": patch
---

Let the inline agent read sibling workspace packages in a monorepo. When the dev server runs from an app subdirectory (e.g. `apps/web`), the spawned Claude agent's working directory is that subdirectory, so reads of `packages/*` needed a permission prompt that a headless run silently denied — the agent burned turns retrying before giving up. The agent now gets the enclosing repository root (git toplevel, or the nearest `pnpm-workspace.yaml` / `package.json` `workspaces` root) as an additional directory. Worktree runs are unaffected (they stay confined to their worktree), the home directory and filesystem root are never granted, and dry-run mode still blocks every write.

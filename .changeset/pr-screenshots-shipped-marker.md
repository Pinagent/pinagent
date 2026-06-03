---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/mcp": patch
---

Fix screenshots never attaching to dock/working-copy PRs. The first cut matched feedback to the branch by `commit_sha`, but inline-mode feedback is never committed per-conversation (the change is committed by the PR step itself), so `commit_sha` was always null and nothing ever matched. The working-copy/dock "Create PR" now attaches screenshots for the resolved, inline, not-yet-shipped feedback sitting in the working copy, and stamps the shipped commit onto those records so a later PR won't re-attach them. Self-correcting and exact — no time/commit heuristics.

---
"@pinagent/widget-dock": patch
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Reconcile PR state via the `gh` CLI, and auto-refresh the PRs tab.

The PRs view's "Refresh" reconciled state through Octokit only, so for
developers authed via the `gh` CLI (no stored token) it did nothing — a PR
closed or merged on GitHub lingered as "open" in the dock. `refreshPullRequests`
now falls back to `gh pr view --json` when there's no token. The PRs tab also
reconciles once automatically when opened (the cached list renders immediately;
the row updates when the reconcile lands), so state no longer silently lags.

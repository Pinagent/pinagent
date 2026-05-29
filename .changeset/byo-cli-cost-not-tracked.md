---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

BYO-model CLI runs show "cost not tracked" instead of a misleading "$0.0000".

The `cli` provider wraps an external agentic CLI that doesn't report token
cost, so it records `totalCostUsd: 0` as a placeholder. Rendering that as a
literal "$0.0000" read as "this run was free" rather than "we can't measure
this run's cost".

A new shared `isUntrackedCost(apiKeySource)` helper (true for the `cli`
provider, mirroring `isNotionalCost` for `oauth`) is now the single source of
truth, used by the three cost-render surfaces — the in-page widget footer, the
plain-text transcript (`pinagent transcript` CLI + MCP tool), and the dock's
transcript result row — to label these runs "cost not tracked". Billed
(API-key) and notional (subscription) runs are unchanged, and the dock's
running-cost chip already hid `$0`, so it needs no change.

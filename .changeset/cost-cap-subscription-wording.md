---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Cost-cap refusal messages no longer claim money was "spent" on a Claude subscription.

`checkCostCaps` gates each turn on the per-conversation cap and monthly
budget by summing the SDK's `total_cost_usd`. On a `claude login` (OAuth)
run that figure is notional — billed against the subscription quota, never
charged — so the breach message ("$5.00 of $5.00 spent") was misleading.

The cap still enforces (it's a proxy for how much agent runtime to allow),
but for subscription runs the message now reads "≈$5.00 of $5.00
API-equivalent (subscription — not billed)", reusing the same
`isNotionalCost` relabeling the dock and widget footer already apply.
API-key runs are unchanged.

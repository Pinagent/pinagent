---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

The dock no longer shows a misleading dollar cost for Claude-subscription runs.

Agent runs report a `total_cost_usd` from the Claude Agent SDK. On a
`claude login` (OAuth) subscription that figure is notional — billed
against the subscription quota, not a card. The in-page widget footer
already relabeled it as `subscription`, but the dock had no access to the
run's credential source, so its cost chip rendered the raw `$` regardless
of auth mode.

`apiKeySource` is now threaded end-to-end: derived from the persisted
`init` event in `Storage` (no DB migration — it's read off the existing
`role='init'` message row), serialized in the feedback HTTP projection, and
carried through the dock transport. A new shared `isNotionalCost(apiKeySource)`
helper is the single source of truth for "is this a billed run?", used by
both the dock's `CostChip` (list row, detail header, and transcript `result`
row) and the widget footer. For subscription runs the dock now shows
`subscription` with the API-equivalent amount in the tooltip; API-key runs
are unchanged.

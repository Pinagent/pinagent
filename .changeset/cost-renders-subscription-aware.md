---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

The remaining cost renderers now relabel notional subscription cost.

After the dock, widget footer, and cost-cap messages were made
subscription-aware, two surfaces still printed the SDK's
`total_cost_usd` as a bare `$` for `claude login` (OAuth) runs, where the
figure is notional (billed against the subscription quota, never
charged):

- The plain-text transcript renderer (`renderTranscript`) shared by the
  `pinagent transcript` CLI and the MCP `get_conversation_transcript`
  tool — now reads `≈$X API-equivalent (subscription)`. It captures the
  source from the transcript's `init` event.
- The markdown log footer (`renderResultFooter`) appended to each
  conversation's log — now reads `≈$X API-equivalent (subscription —
  not billed)`. `apiKeySource` is threaded from the run's init message
  (and from the stored record on the resolution path).

Both reuse the shared `isNotionalCost` helper. API-key runs are
unchanged.

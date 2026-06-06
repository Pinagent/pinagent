---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---
Pull a spawned agent's widget off the page when its anchored element is gone
for good. Instead of leaving an orphaned "anchor lost" dot, the widget now
freezes briefly (riding out transient HMR/re-render swaps) and then removes
itself entirely — the conversation lives on in the FAB running-agents tray.
Opening it from the tray with no dock mounted drops a free-floating,
unanchored chat into the viewport rather than pinning it to a missing element.

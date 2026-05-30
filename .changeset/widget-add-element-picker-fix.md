---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

fix(widget): make "Add another element to this conversation" work

The expanded-widget footer button that adds another picked element to a
running conversation did nothing. It handed off to the picker via a
`postMessage` to the host window, but the composer iframe runs no scripts
of its own — the button's handler executes in the host realm, so the
message arrived with `event.source === window` rather than
`iframe.contentWindow`, and the receiving guard dropped it. The handler
now calls the picker controller directly (it already had the context and
composer in scope), so picking an element joins the conversation as a
queued follow-up as intended.

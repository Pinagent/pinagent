---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

fix(widget): keep the answer affordance when minimizing mid-question

When the agent asked a question (`ask_user`) while the conversation was
expanded and the user then minimized it, the single-line minimal bar showed a
stop icon for a not-actually-running agent instead of the alert + answer icon.
The pending-ask state now lives on the composer (`needsInput`), so
`applyMiniChrome` re-applies the `needs-input` attention state on minimize and
clears it on expand/answer.

---
'@pinagent/vite-plugin': minor
'@pinagent/next-plugin': minor
'@pinagent/widget-dock': patch
---

Make an agent that is waiting on you impossible to miss. When the inline agent is blocked on a permission prompt or an `ask_user` question:

- the minimized card reads "Approve? · auto-deny in 4:05" (or "Needs your input · closes in 9:12") and counts down, and expanding it scrolls to and focuses the answer form;
- the running-agents tray flags the row in amber with "Approve? · waiting 3m", sorts it first, labels its action "Answer", and re-expands itself if it was minimized when a new ask opens;
- the minimized pin's badge turns amber and pulses;
- the dock lists the conversation as "Needs reply".

The conversation list API gains an `awaitingInput` field (backed by `active_runs.awaiting_ask_id`, now maintained by the runner), and `ask_user` events carry an `expiresAt`. Also fixes the card label never switching to "Needs your input" for an ask raised while the card was expanded, and staying on it after the ask was answered or expired.

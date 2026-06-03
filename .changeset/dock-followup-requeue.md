---
"@pinagent/widget-dock": patch
---

Queue dock follow-up replies typed during a running turn instead of letting the server bounce ("a turn is already in progress") and silently drop them. Replies are parked and flushed one-per-turn-end, a send the server bounces is re-queued (nothing lost), and the transient bounce error is hidden — mirroring the per-element widget's `followUpQueue`.

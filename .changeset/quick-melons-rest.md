---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

fix(widget): the pin's keyboard activation no longer cancels an in-progress pick

While picking, the picker owns the keyboard (Enter commits, Escape cancels). The pin keeps focus when a pick is started by clicking it, so a stray Space — or any Enter the picker didn't handle — used to re-toggle picking off and discard the user's pending multi-selection. The pin's Enter/Space handler now defers while a pick is in progress; cancelling stays available via Escape, the hotkey, or clicking the pin.

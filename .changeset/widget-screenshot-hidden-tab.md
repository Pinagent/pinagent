---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Widget: sending a comment no longer stalls on "Sending…" when the tab is hidden. The screenshot step waited for an animation frame, which Chrome never runs in a background tab, so a comment sent just before switching tabs waited until you came back. The capture now finishes in the background and is capped at 10 seconds; past that, the comment goes out without a screenshot.

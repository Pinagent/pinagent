---
'@pinagent/vite-plugin': patch
'@pinagent/next-plugin': patch
---

feat(widget): lay the composer footer shortcut hints out in a 2×2 grid

The keyboard-shortcut hints under the composer textarea now render as a 2×2
grid instead of a single inline row. The fourth cell surfaces the `c` comment
hotkey alongside the existing `↵ submit`, `⇧↵ newline`, and `esc cancel` hints.

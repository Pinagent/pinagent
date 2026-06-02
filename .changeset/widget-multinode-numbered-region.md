---
'@pinagent/vite-plugin': minor
'@pinagent/next-plugin': minor
---

feat(widget): numbered multi-node badges + region snip selection

Multi-picking now stamps each selected element with a gold "1, 2, 3…" order
badge (on the page and in the "+N" hover popover). A new region-snip mode
(press `R` while picking) lets you drag out a rectangle to capture a specific
section of the page; `Enter` commits the selection (handy for region-only
snips). Regions are composable with element picks — the submitted screenshot
is cropped to the union of the drawn region(s) and any picked elements. The
crop is baked into the uploaded image, so nothing new is persisted server-side.

---
"@pinagent/next-plugin": minor
"@pinagent/vite-plugin": minor
---

feat(widget): walk the picker highlight up the ancestry with ↑/↓

`document.elementFromPoint` always returns the innermost element under the
cursor, so a parent that a descendant visually covers — e.g. a `<nav>`,
`<aside>`, or `<div>` fully filled by the `<a>` inside it — was impossible
to hover or select. Picking now tracks the chain of source-tagged
(`data-pa-loc`) ancestors for the hovered element: ↑ walks the highlight
outward to the enclosing element, ↓ back toward the cursor, and a click
commits whichever level is currently highlighted. Moving the mouse rebuilds
the chain and snaps back to the hovered element. The pick hint advertises
↑/↓ whenever a parent exists and shows the targeted tag once you climb.

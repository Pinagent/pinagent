---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

feat(widget): smaller, draggable minimized agent bar

The single-line minimal bar (`viewState: 'minimal'`) shown for a spawned agent
is now more compact and can be repositioned by hand:

- **Smaller.** The status spinner shrinks (13px → 10px, thinner stroke) and the
  card's vertical padding tightens (8px → 4px), dropping the bar's height from
  46px to 36px (`MINI_H`).
- **Draggable.** A leading grip now rides the left edge of the minimized bar, so
  it can be dragged to reposition exactly like the expanded composer (same
  `userOffset` machinery). Clicking elsewhere on the bar still expands it; the
  grip is hidden only when the widget collapses to a floating dot.

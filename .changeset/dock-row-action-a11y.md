---
"@pinagent/widget-dock": patch
---

Row action buttons: keep hover-revealed actions reachable on touch.

The per-row Land / quick-archive buttons (and the diff file-open hint)
reveal on `group-hover`, which Tailwind v4 gates behind
`@media (hover: hover)` — so on touch devices (no hover) they never
appeared and the actions were effectively unreachable. They now stay
visible where hovering isn't available (`@media (hover: none)`), keep the
clean hover-reveal on pointer devices, and reveal on keyboard focus
(`focus-visible` / `group-focus-visible`) as before.

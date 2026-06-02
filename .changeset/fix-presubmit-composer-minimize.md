---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Fix an un-submitted composer collapsing into a broken, clipped card. Pressing the pick hotkey (`c`) while a freshly spawned composer was open — and picking another element — minimized that draft. Its minimal bar lives inside the still-hidden stream pane, so it collapsed to a stuck, empty "bugged out" state. A pre-submit draft has no conversation to preserve, so it's now discarded (like Esc already does) instead of minimized.

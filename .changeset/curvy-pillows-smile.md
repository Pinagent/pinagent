---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

fix(widget): pressing Enter after multi-selecting nodes now reliably opens the composer

When the picker was entered by clicking the pin, the FAB kept keyboard focus, so the Enter that commits a multi-node selection also bubbled to the FAB's keydown handler. By then the commit had flipped the mode to idle, so the FAB re-toggled straight back into picking — making Enter look like a no-op. The picker's Enter handler now stops propagation so committing the selection is its sole effect.

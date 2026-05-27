---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Phase G — re-anchor widgets on HMR / DOM rewrites. When the host app's
framework replaces a widget's anchor Node (Vite HMR, React re-render,
Next 16 RSC swap), the widget's rAF position loop now detects the stale
reference (`composer.target.isConnected === false`) and tries to relocate
the element by `data-pa-loc` first (precise `<file>:<line>:<col>` match
from `@pinagent/babel-plugin`), CSS selector second. On success the new
target is swapped in silently. On failure the bubble flips to a dashed
amber "anchor-lost" ring with a tooltip prompting the user to click it
and retry the lookup — visible failure instead of the widget freezing at
stale coordinates.

No protocol change. No server-side change. Pure widget IIFE work.

---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Remove the quick-action suggestion chips from the composer

The per-element composer no longer renders the "Recolor / Resize / Make it a
link" quick-action chips above the textarea. The `quick-actions.ts` catalog,
its tests, the `chips` field on `ComposerMeta`, the chip rendering/wiring, and
the `.qa-chip` styles are all gone — the composer now opens straight to the
"Describe the change you want…" textarea. Bumps both consumer plugins so the
new widget IIFE ships.

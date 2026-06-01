---
'@pinagent/vite-plugin': minor
'@pinagent/next-plugin': minor
'@pinagent/ui': minor
'@pinagent/widget': patch
---

feat(widget): dark-mode redesign matching the dock

The in-page widget now renders in dark mode, matching the dock's dark theme —
deep ink surfaces (`#201B21` / `#2A2528`), cream text, gold accent. The
composer card, header pills, breadcrumb, quick-action chips, textarea, stream
log, @-mention menu, follow-up bar, minimized bubbles, drag handle, tray,
hint, and toast were all reskinned; primary buttons invert to cream-on-ink for
a strong CTA on dark. The shadow root and composer iframe now opt into
`color-scheme: dark`.

A dark-tuned status palette (`STATUS_DARK`) was added to `@pinagent/ui/tokens`
(mirroring the `.dark` status block in `globals.css`) so the widget's status
dots, bubbles, and lifecycle chips read on the dark surfaces without drifting
from the dock.

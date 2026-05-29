---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

refactor(widget): split the 3.2k-line `widget.ts` into focused modules

Internal-only restructuring of `@pinagent/widget`. `widget.ts` now keeps just
the `mount()` orchestrator; the WebSocket client, stream/transcript renderer,
composer HTML templating, crop math, keyboard helpers, config readers, layout
constants, and shared types each move to their own module. The embedded widget
IIFE is functionally unchanged — this bumps the consumer plugins only so the
re-embedded bytes ship (per the widget-cascade rule).

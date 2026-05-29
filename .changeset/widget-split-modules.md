---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

refactor(widget): split the 3.2k-line `widget.ts` into focused modules

Internal-only restructuring of `@pinagent/widget`. `widget.ts` shrinks from
~3230 lines to ~200 — it now only builds the DOM + a shared `WidgetContext`
and wires three controllers together. Everything else moves to its own module:

- `ws-client.ts` — the multiplexed page WebSocket
- `stream-handler.ts` — transcript rendering + worktree lifecycle row
- `composer.ts` — composer lifecycle (create/open/restore/swap/hop) + positioning
- `composer-iframe.ts` — the composer iframe's internal form, submit, and stream wiring
- `composer-html.ts` — composer HTML templating
- `picker.ts` — the element-picking session
- `fab-tray.ts` — the FAB and running-agents tray
- `context.ts` — the shared `WidgetContext` + small shared types
- `crop.ts`, `keyboard.ts`, `config.ts`, `constants.ts`, `pin-icon.ts`, `types.ts`

The embedded widget IIFE is functionally unchanged — this bumps the consumer
plugins only so the re-embedded bytes ship (per the widget-cascade rule).

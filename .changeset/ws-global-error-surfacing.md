---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/widget-dock": patch
---

Surface connection-/project-level WebSocket `error` frames (the protocol allows an absent `feedbackId`) instead of silently dropping them. The widget and dock clients now `console.warn` a global server error that has no conversation to route to, so a relay/connection failure isn't invisible. (The widget half ships via the bundled `@pinagent/widget`, so both plugins re-embed it.)

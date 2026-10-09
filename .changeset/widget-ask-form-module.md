---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Internal: move the widget's ask / permission-prompt form markup into its own module so `stream-handler.ts` stays under the 1000-line limit. No behaviour change.

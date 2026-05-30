---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

Fix broken npm install: published artifacts depended on the unpublished `@pinagent/widget-dock@0.0.0` (404). `@pinagent/widget-dock` is now published, so `dock: true` resolves for installed consumers.

---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Smooth out the agent widget's loading state: instead of showing an empty bordered box between submit and the first streamed event, the stream log is collapsed and the card hugs its header/footer, then grows the instant the agent's first output streams in.

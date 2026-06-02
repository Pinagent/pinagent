---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
'@pinagent/widget-dock': patch
---

Collapse agent tool calls in the conversation feed into a quiet, opt-in group so the transcript reads like a chat with the agent rather than a stream of machine activity. Consecutive `tool_use` / `tool_result` events now render as a single `N tool calls` line that expands on tap to show the individual calls — in both the in-page widget and the dock.

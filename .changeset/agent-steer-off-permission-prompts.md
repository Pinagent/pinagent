---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
"@pinagent/react-native": patch
---

Steer the inline agent away from calls that stall on a permission prompt. Its system prompt now names Pinagent's pre-approved MCP tools exactly (`mcp__pinagent__get_feedback`, `mcp__pinagent__resolve_feedback`, …), so a project that registers several similarly named pinagent servers no longer has the agent call an un-allowlisted copy and finish without resolving the feedback. It also asks the agent to find and read code with the Read / Grep / Glob tools instead of shell pipelines, and to keep any Bash call to one simple command with literal paths (no `$(…)`, shell variables or `cd … &&` chains), since those can't be checked automatically and each one waits on the developer in the widget.

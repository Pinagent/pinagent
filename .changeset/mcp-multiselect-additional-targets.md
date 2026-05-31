---
"@pinagent/mcp": patch
---

fix(mcp): surface multi-selected elements to the agent

When a developer Cmd/Ctrl-clicks several elements and leaves one comment, the
extra picks (`additionalAnchors`) were captured and persisted but never told to
the agent, so only the primary element got changed.

The channel notification now includes an `additionalTargets` attribute (a
comma-separated `file:line:col` list) and the channel instructions direct the
agent to address every target before resolving. The inline `agent-runner`
prompt enumerates the same extras as numbered targets.

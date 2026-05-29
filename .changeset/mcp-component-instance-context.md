---
'@pinagent/mcp': minor
---

`get_feedback` now surfaces enclosing-component and loop-instance
context when present: the `component` name, the `component path`
(outer→inner chain), and — when the target's `file:line` is shared by
several rendered instances — which instance the developer clicked plus a
content fingerprint. This helps an MCP-driven agent edit the correct
`.map()` item rather than the first match. Fields are omitted for
single-pick / uninstrumented feedback, so existing output is unchanged.

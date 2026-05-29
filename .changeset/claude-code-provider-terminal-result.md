---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

The Claude provider now emits a clean terminal result on abort and SDK errors.

`ClaudeCodeProvider` let the Claude Agent SDK's stream throw straight through
to the orchestrator's generic catch, so clicking **Stop** surfaced as an
`error` state carrying a raw `AbortError` message, and any SDK failure
produced no terminal `result` event at all — unlike the CLI provider, which
emits a `result` with a meaningful subtype.

The provider now wraps the SDK stream: if it throws before delivering its own
`result`, the provider synthesizes a terminal `result` — `subtype: 'aborted'`
when the run was aborted (no error noise), or `subtype: 'error'` with the
failure detail otherwise. Both providers now guarantee a terminal `result`
with a consistent subtype, so the widget always leaves the running state and a
Stop reads as "aborted" rather than an error.

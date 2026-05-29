---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

The dock now connects to the same WS server the widget does when the default port is taken.

The widget learns its WS URL from a `window.__pinagentConfig` prelude the
dev-server injects into `/__pinagent/widget.js`, so when the server falls back
off the default port 53636 (because another/stale pinagent dev-server already
holds it) the widget follows to the new port. The dock's `embedded.html` is
served as a plain static file with no such injection, so the dock fell back to
the hardcoded 53636 and silently talked to the *other* server — out of sync
with the widget and the project's real DB.

Both plugins now inject the actually-bound WS port into the dock's
`embedded.html` `<head>` as `window.__pinagentConfig`, mirroring the widget
bundle. The dock also treats injected config as authoritative — an explicit
`wsUrl: null` means "no WS here" rather than a cue to guess the default port
and reach a stranger.

---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

The in-page widget now trusts the dev-server's injected WS config instead of guessing the default port.

When the dev-server can't bind the default WS port 53636 (a stale or
second pinagent dev-server already holds it) it walks to a fallback port
and injects the actually-bound URL into the widget bundle as
`window.__pinagentConfig`. The widget's `createWsClient` previously fell
back to a hardcoded `ws://<host>:53636` whenever `wsUrl` was missing —
which, when the config explicitly carried `wsUrl: null` ("this server has
no agent WS"), connected the widget to whatever *other* project's
dev-server held 53636.

`resolveWsUrl` now treats injected config as authoritative: an explicit
`null` leaves the WS client inert (feedback capture still works; only live
streaming is unavailable, which is correct when no agent runs here). The
default-port guess survives only when no config was injected at all (a host
page mounting the widget without the plugin prelude). Mirrors the dock-side
hardening.

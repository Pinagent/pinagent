---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

The in-page widget no longer duplicates a conversation's transcript when its WebSocket reconnects.

The dev-server replays a conversation's full transcript from the start on
every fresh `subscribe`. On a reconnect the widget re-subscribed the open
conversation, so the whole transcript was re-rendered onto the stream log
it already had (and re-inserted into the browser-cache mirror, which then
resurfaced the duplicates on the next page reload).

`WidgetWsClient` now fires an `onReset` on each per-feedback handler before
re-subscribing on a reconnect (not on the initial connect). The stream
handler clears its rendered log and render accumulators and wipes the
conversation's cached messages — serialised on one write chain so the
delete lands before the replay re-inserts — letting the replay rebuild
exactly one copy. This mirrors the dock-side fix and also self-heals events
that arrived while the socket was down.

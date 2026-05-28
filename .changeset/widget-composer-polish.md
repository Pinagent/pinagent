---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Polish the anchored composer: drag handle into the header + auto-grow
textarea.

The drag grip (now an 8-dot 2×4 SVG) moves from "above the iframe's
top edge" to "inside the iframe's top-right corner", flush with the
12px card padding so it reads as part of the header rather than a
detached badge. The identity row reserves 28px of right padding so
long element labels don't slide under it.

The composer textarea now auto-grows as the user types. The iframe
posts its textarea's natural scrollHeight to the parent via
postMessage on every input + after a chip prefill; the parent clamps
to [80, 240] px of textarea height (composer iframe height grows by
the delta), reposition()s, and shrinks back down when content gets
deleted. Past 240 px of textarea content, internal scrolling takes
over rather than pushing the composer off-screen.

Listener cleanup happens in close() — only the live composer's
iframe.contentWindow can drive its size; messages from other windows
or the stream pane are filtered out.

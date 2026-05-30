---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

fix(widget): restore composer auto-grow and the "+N" extras hover-flash

These shared the root cause fixed for the add-element picker: the composer
`srcdoc` iframe runs no scripts of its own, so its event handlers execute
in the host realm. Their `iwin.parent.postMessage(...)` calls therefore
arrived with `event.source === window` (not `iframe.contentWindow`) and
were dropped by the receiving `ev.source` guard — so the composer textarea
never grew to fit a multi-line comment, and hovering the "+N more" badge
didn't flash the extra picked elements on the page.

The iframe wiring now calls the controller directly (`onTextareaHeight`,
`onExtrasHover`, `onExtrasLeave`) instead of posting messages, and the
now-dead `onIframeMessage` listener and its broken guard are removed.

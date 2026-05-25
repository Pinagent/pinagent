# @pinagent/widget

Browser UI for Pinagent. Renders a fixed 💬 button inside a closed shadow root, lets the user pick a DOM element and write a comment, captures a page screenshot, and POSTs the result to `/__pinagent/feedback` on the same origin.

**You should not install this package directly.** It is built as an IIFE and embedded inside `@pinagent/vite-plugin` at publish time. The plugin serves it from `/__pinagent/widget.js`.

## Build

```bash
pnpm build
```

Produces `dist/widget.global.js` (single IIFE, no external deps).

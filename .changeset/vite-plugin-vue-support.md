---
"@pinagent/vite-plugin": minor
---

Tag Vue Single-File Components. The plugin's `transform` hook now dispatches on
file extension — `.vue` SFCs are tagged via `@pinagent/vue-plugin`'s
`transformVue` (splicing `data-pa-loc` + `data-pa-comp` onto `<template>`
markup), while `.tsx`/`.jsx` continue through the JSX transform. Because the
plugin already runs with `enforce: 'pre'`, SFCs are tagged before
`@vitejs/plugin-vue` compiles them. The widget, `/__pinagent` middleware,
WebSocket server, and agent runtime are unchanged, so the full click→agent loop
now works in Vue + Vite apps with no extra setup beyond adding `pinagent()` to
`vite.config`.

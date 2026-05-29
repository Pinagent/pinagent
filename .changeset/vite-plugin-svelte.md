---
"@pinagent/vite-plugin": minor
---

Tag Svelte components. The plugin's `transform` hook now also dispatches
`.svelte` files through `@pinagent/svelte-plugin`'s `transformSvelte` (splicing
`data-pa-loc` + `data-pa-comp` onto component markup), alongside the existing
`.vue` and `.tsx`/`.jsx` handling. Because the plugin already runs with
`enforce: 'pre'`, components are tagged before `@sveltejs/vite-plugin-svelte`
compiles them. The widget, `/__pinagent` middleware, WebSocket server, and agent
runtime are unchanged, so the full click→agent loop now works in Svelte + Vite
apps with no extra setup beyond adding `pinagent()` to `vite.config`.

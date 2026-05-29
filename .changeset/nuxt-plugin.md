---
"@pinagent/nuxt-plugin": minor
---

New package: `@pinagent/nuxt-plugin`, a Nuxt module that brings Pinagent's
click→agent loop to Nuxt apps. Nuxt's dev bundler is Vite, so the module reuses
the whole `@pinagent/vite-plugin` via `addVitePlugin` — source tagging (Vue SFC
`<template>` + `.tsx`/`.jsx`), the `/__pinagent/*` dev middleware, and the
WebSocket server — and adds the one piece Vite reuse can't: injecting the widget
loader into Nuxt's server-rendered HTML via the app head. Dev-only; production
builds are untouched. Add `'@pinagent/nuxt-plugin'` to `modules` in
`nuxt.config`.

---
"@pinagent/vite-plugin": minor
"@pinagent/nuxt-plugin": minor
---

Add dock support to the Nuxt module. `@pinagent/vite-plugin` now exports the
dock iframe loader and host-bridge script bodies (`DOCK_IFRAME_SCRIPT`,
`DOCK_HOST_BRIDGE_SCRIPT`) it already used internally, so non-Vite hosts can
inject them their own way (the tags it injects via `transformIndexHtml` are
unchanged). `@pinagent/nuxt-plugin` gains a `dock: boolean` option: when enabled
it passes `dock: true` through to the reused Vite plugin (so the middleware
serves `/__pinagent/dock/*`) and injects the dock iframe + host bridge into the
Nuxt app head at body-close — the SSR analogue of the SPA `transformIndexHtml`
injection. Dev-only, like everything else in the module.

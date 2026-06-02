# @pinagent/nuxt-plugin

## 0.1.3

### Patch Changes

- Updated dependencies [9f0be42]
- Updated dependencies [22259ed]
- Updated dependencies [7f7c94f]
- Updated dependencies [53379b0]
- Updated dependencies [02bc4f1]
  - @pinagent/vite-plugin@0.7.0

## 0.1.2

### Patch Changes

- Updated dependencies [4b51350]
- Updated dependencies [373027c]
- Updated dependencies [93d4ac7]
- Updated dependencies [6228c2a]
- Updated dependencies [6d40d1f]
- Updated dependencies [d68d610]
- Updated dependencies [60f4d94]
- Updated dependencies [327517d]
  - @pinagent/vite-plugin@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [423f190]
- Updated dependencies [393a4d5]
- Updated dependencies [ef98fba]
  - @pinagent/vite-plugin@0.5.0

## 0.1.0

### Minor Changes

- 6435cb2: Add dock support to the Nuxt module. `@pinagent/vite-plugin` now exports the
  dock iframe loader and host-bridge script bodies (`DOCK_IFRAME_SCRIPT`,
  `DOCK_HOST_BRIDGE_SCRIPT`) it already used internally, so non-Vite hosts can
  inject them their own way (the tags it injects via `transformIndexHtml` are
  unchanged). `@pinagent/nuxt-plugin` gains a `dock: boolean` option: when enabled
  it passes `dock: true` through to the reused Vite plugin (so the middleware
  serves `/__pinagent/dock/*`) and injects the dock iframe + host bridge into the
  Nuxt app head at body-close — the SSR analogue of the SPA `transformIndexHtml`
  injection. Dev-only, like everything else in the module.
- 51fd345: New package: `@pinagent/nuxt-plugin`, a Nuxt module that brings Pinagent's
  click→agent loop to Nuxt apps. Nuxt's dev bundler is Vite, so the module reuses
  the whole `@pinagent/vite-plugin` via `addVitePlugin` — source tagging (Vue SFC
  `<template>` + `.tsx`/`.jsx`), the `/__pinagent/*` dev middleware, and the
  WebSocket server — and adds the one piece Vite reuse can't: injecting the widget
  loader into Nuxt's server-rendered HTML via the app head. Dev-only; production
  builds are untouched. Add `'@pinagent/nuxt-plugin'` to `modules` in
  `nuxt.config`.

### Patch Changes

- Updated dependencies [9f4706c]
- Updated dependencies [346bbd7]
- Updated dependencies [832e583]
- Updated dependencies [08145bb]
- Updated dependencies [b29c2df]
- Updated dependencies [66399c8]
- Updated dependencies [6435cb2]
- Updated dependencies [3d026bd]
- Updated dependencies [08145bb]
- Updated dependencies [cf692f5]
- Updated dependencies [0762aae]
- Updated dependencies [6d7b12e]
- Updated dependencies [b3a153a]
- Updated dependencies [8d871a1]
  - @pinagent/vite-plugin@0.4.0

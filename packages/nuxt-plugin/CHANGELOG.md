# @pinagent/nuxt-plugin

## 0.2.1

### Patch Changes

- 4d4d38b: fix(nuxt-plugin): annotate the module's default export to survive `@nuxt/schema` version skew

  `defineNuxtModule`'s return type is `NuxtModule<…>` from `@nuxt/schema`. When the
  workspace resolves more than one `@nuxt/schema` (e.g. an example app bumps `nuxt`
  so `4.4.6` and `4.4.7` coexist), `tsc` infers the default export's type against a
  non-portable `.pnpm/@nuxt+schema@x/…` path and fails with TS2883 ("inferred type
  of 'default' cannot be named … not portable"). Annotate the export with an
  explicit `NuxtModule<ModuleOptions>` (imported from the bare `@nuxt/schema`
  specifier, now declared as a type-only devDependency) so the public type is
  portably nameable regardless of which `@nuxt/schema` identity resolves — the same
  decoupling the vite-plugin `addVitePlugin` cast already applies.

- 16292a2: fix(nuxt-plugin): make the `addVitePlugin` call resilient to `vite` type-identity skew

  `@nuxt/kit`'s `addVitePlugin` is typed against the `vite` _it_ resolves, while
  `pinagent()` returns a `Plugin` typed against the `vite` `@pinagent/vite-plugin`
  resolves. pnpm peer-deduping routinely produces two `vite` instances — same
  version, different peer hash (e.g. one hashed against `@types/node@x.y.1`, the
  other `@types/node@x.y.3`) — whose structurally identical `Plugin<any>` types are
  nominally unrelated, so `tsc` rejected the call with TS2345. Any lockfile re-hash
  (every Dependabot bump) could flip which instance each side gets, breaking
  `pnpm typecheck` on the nuxt-plugin even though the runtime object is a valid vite
  plugin. The call now casts to `addVitePlugin`'s own parameter type, decoupling it
  from the resolved `vite` identity without pinning `vite` across the workspace.

## 0.2.0

### Minor Changes

- e743234: Forward the `apiKey` and `worktreeServeCommand` options from `nuxt.config.ts`'s
  `pinagent: {…}` to the underlying `@pinagent/vite-plugin`, reaching full option
  parity with the Vite and Next.js integrations.
  - `apiKey` — explicit, opt-in agent key (bridged to the runner as
    `PINAGENT_AGENT_API_KEY`). Unset still means subscription auth; Pinagent never
    reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` implicitly.
  - `worktreeServeCommand` — custom dev-server command for the dock's worktree
    "Open app" action (e.g. `nuxt dev --port {port}`).

  `root` remains deliberately derived from `nuxt.options.rootDir` and is not a
  forwarded option.

### Patch Changes

- Updated dependencies [7aea68a]
  - @pinagent/vite-plugin@0.11.1

## 0.1.10

### Patch Changes

- Updated dependencies [e2de120]
- Updated dependencies [a92908f]
- Updated dependencies [008a1bd]
- Updated dependencies [c3d7078]
  - @pinagent/vite-plugin@0.11.0

## 0.1.9

### Patch Changes

- Updated dependencies [15eb766]
- Updated dependencies [57eaf26]
- Updated dependencies [454af34]
  - @pinagent/vite-plugin@0.10.1

## 0.1.8

### Patch Changes

- Updated dependencies [5961da2]
- Updated dependencies [5873372]
- Updated dependencies [91983c6]
- Updated dependencies [df39f14]
- Updated dependencies [c159148]
- Updated dependencies [ec07562]
- Updated dependencies [2971c99]
- Updated dependencies [5ae2c40]
  - @pinagent/vite-plugin@0.10.0

## 0.1.7

### Patch Changes

- Updated dependencies [ec33fdd]
- Updated dependencies [13e2636]
- Updated dependencies [a57be06]
- Updated dependencies [0628a6a]
- Updated dependencies [eaedf83]
- Updated dependencies [2989bbb]
- Updated dependencies [8ba03fc]
- Updated dependencies [de6ecbf]
  - @pinagent/vite-plugin@0.9.0

## 0.1.6

### Patch Changes

- Updated dependencies [f5fa586]
- Updated dependencies [1ec0fac]
- Updated dependencies [98e0f61]
- Updated dependencies [678bb53]
- Updated dependencies [dbb238d]
  - @pinagent/vite-plugin@0.8.0

## 0.1.5

### Patch Changes

- Updated dependencies [cd0cac9]
  - @pinagent/vite-plugin@0.7.2

## 0.1.4

### Patch Changes

- @pinagent/vite-plugin@0.7.1

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

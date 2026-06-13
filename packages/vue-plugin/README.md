# @pinagent/vue-plugin

> **Status: shipped — internal, not installable.** This package is the home of
> Pinagent's one genuinely Vue-specific piece: source-mapping `<template>`
> markup back to `file:line:col`. It is `private: true` (never published) and is
> bundled into [`@pinagent/vite-plugin`](../vite-plugin) at build time as an
> internal devDependency. **Vue support already ships** — `@pinagent/vite-plugin`'s
> transform dispatch calls `transformVue` for `.vue` files (plain Vue + Vite
> apps), and [`@pinagent/nuxt-plugin`](../nuxt-plugin) covers Nuxt by wrapping
> `@pinagent/vite-plugin` directly. See [Where this fits](#where-this-fits) for
> how users get the feature.

The Vue analogue of [`@pinagent/babel-plugin`](../babel-plugin). It injects a
`data-pa-loc="file:line:col"` attribute (plus a `data-pa-comp` component name)
onto every element in a Vue Single-File Component `<template>` block at build
time. The widget reads these attributes when the user picks an element, so each
comment anchors to the exact source location and reports the component it lives
in.

Vue is the interesting case because SFC templates **aren't JSX** — they're Vue's
own HTML-flavoured template syntax, invisible to Babel. So instead of walking a
JSX AST we walk the template AST that `@vue/compiler-sfc` produces and splice the
same attribute in. Everything downstream of the attribute (widget, `/__pinagent`
middleware, screenshots, `@pinagent/agent-runner`, SQLite, MCP) is
framework-agnostic and needs **zero** changes.

## What lives here

- **`transform.ts`** — `transformVue(code, { relPath })`. Parses the SFC with
  `@vue/compiler-sfc`, walks the `<template>` AST (descending through `v-if`
  branches and `v-for` bodies), and splices `data-pa-loc` (and `data-pa-comp`)
  after each element's tag name. Returns the rewritten source, or `null` when
  there's nothing to tag (no template, no elements, or an unparseable file) —
  the same "null means skip" contract as the babel plugin, so bundler glue can
  treat both identically. In Vue an SFC *is* one component, so the enclosing
  component name is derived from the filename (`PriceCard.vue` → `PriceCard`)
  and every element — including every `v-for` instance — carries it, which is
  what lets downstream loop-instance disambiguation resolve to the right item.
- **`vite.ts`** (`@pinagent/vue-plugin/vite`) — a standalone Vite plugin,
  `vitePlugin()`, that runs `transformVue` on `.vue` files. It uses
  `enforce: 'pre'` so it tags the **raw** SFC source before `@vitejs/plugin-vue`
  compiles it; plugin-vue then re-parses the tagged source, so the attributes
  flow through to the compiled template. Dev-only (`command === 'serve'`),
  matching Pinagent's "production builds are untouched" invariant. It tags only
  — it doesn't inject the widget or the `/__pinagent` middleware. In practice
  you don't use it directly: `@pinagent/vite-plugin` calls `transformVue`
  in-process (see [Where this fits](#where-this-fits)) and ships the widget +
  middleware alongside, so the whole loop comes from one plugin.
- **`index.ts`** — public surface: `transformVue`, `TransformOptions`.

### End-to-end demonstration

`tests/vite.test.ts` spins up a real Vite dev server with `vitePlugin()` ahead
of `@vitejs/plugin-vue`, SSR-renders `tests/fixtures/App.vue`, and asserts the
rendered DOM carries the attributes. The actual output:

```html
<main data-pa-loc="App.vue:9:3" data-pa-comp="App" class="demo">
  <h1 data-pa-loc="App.vue:10:5" data-pa-comp="App">Pinagent Vue demo</h1>
  <button data-pa-loc="App.vue:11:5" data-pa-comp="App">Count is 0</button>
  <ul data-pa-loc="App.vue:12:5" data-pa-comp="App">
    <li data-pa-loc="App.vue:13:7" data-pa-comp="App">Apples</li>
    <li data-pa-loc="App.vue:13:7" data-pa-comp="App">Pears</li>
  </ul>
  <p data-pa-loc="App.vue:16:5" data-pa-comp="App">not yet</p>
</main>
```

The widget walks up from a clicked node to the nearest `data-pa-loc` — exactly
as it does for React — so this is all the source mapping a Vue app needs.

## What it skips

- Files with no `<template …>` block — quick regex prefilter avoids parsing.
- `<template>` and `<slot>` — compiler constructs, not real DOM, so there's
  nothing to anchor a click to. Native elements and components are tagged
  (a component's fallthrough attributes land on its root DOM node).
- Elements that already carry `data-pa-loc` — idempotent, safe to re-run.
- Files that fail to parse — returns `null` rather than crashing the build.

`data-pa-loc` carries a POSIX-relative `file:line:col`. Vue's SFC compiler
reports element locations relative to the **whole file** (not the template
block) and columns are already 1-indexed pointing at the `<`, which matches the
convention the babel plugin normalises JSX columns to — so the two transforms
emit identical attribute shapes (`data-pa-loc` + `data-pa-comp`).

## Where this fits

Vue support is shipped, layered on top of the framework-agnostic rest of
Pinagent. The only Vue-specific code is the transform in this package;
everything below it is reused as-is:

| Layer | Source | How |
|---|---|---|
| Source tagging | **this package** | the only Vue-specific work — `transformVue` |
| Bundler glue (Vite / Nuxt) | `@pinagent/vite-plugin` | its transform hook dispatches on extension: `transformVue` for `.vue`, `transformSvelte` for `.svelte`, `transformJsx` for `.tsx` (`vite-plugin/src/index.ts`) |
| Widget injection | `@pinagent/widget` | embedded in `@pinagent/vite-plugin` (vanilla JS, no React) |
| Feedback API + WebSocket | `@pinagent/vite-plugin` middleware | as-is |
| Agent runtime, DB, MCP | `@pinagent/agent-runner`, `@pinagent/db`, `@pinagent/mcp` | as-is |

**How users get it.** Two paths, depending on the framework:

- **Plain Vue + Vite** → `@pinagent/vite-plugin` directly. It tags `.vue` SFCs
  (alongside `.svelte` and `.tsx`), injects the widget, and mounts the
  `/__pinagent` middleware. (See [`examples/vue-vite`](../../examples/vue-vite)
  once that example lands; for now [`examples/sveltekit-app`](../../examples/sveltekit-app)
  exercises the same `@pinagent/vite-plugin` dispatch path end-to-end.)
- **Nuxt** → [`@pinagent/nuxt-plugin`](../nuxt-plugin). The Nuxt module wraps
  **`@pinagent/vite-plugin` directly** — Nuxt's bundler is Vite, so the module
  registers the same transform-and-inject plugin and wires the `/__pinagent`
  surface through Nitro. **It does not depend on `@pinagent/vue-plugin`**; the
  `transformVue` it ultimately runs is the copy bundled inside `@pinagent/vite-plugin`.

This package stays `private: true` on purpose: publishing the transform
standalone has no consumer story — every user reaches it through
`@pinagent/vite-plugin` (and, for Nuxt, through `@pinagent/nuxt-plugin`). The
decision is settled; this isn't unfinished work.

## Build & test

```bash
pnpm --filter @pinagent/vue-plugin build
pnpm exec vitest run packages/vue-plugin
```

Dual ESM + CJS under `dist/` via `tsdown`.

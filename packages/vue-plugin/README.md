# @pinagent/vue-plugin

> **Status: proof-of-concept.** This package proves out the one genuinely
> Vue-specific piece of Pinagent — source-mapping `<template>` markup back to
> `file:line:col`. It is not yet wired into a Vite/Nuxt dev server or shipped as
> an installable integration. See [Where this fits](#where-this-fits) below.

The Vue analogue of [`@pinagent/babel-plugin`](../babel-plugin). It injects a
`data-pa-loc="file:line:col"` attribute onto every element in a Vue Single-File
Component `<template>` block at build time. The widget reads this attribute when
the user picks an element, so each comment anchors to the exact source location.

Vue is the interesting case because SFC templates **aren't JSX** — they're Vue's
own HTML-flavoured template syntax, invisible to Babel. So instead of walking a
JSX AST we walk the template AST that `@vue/compiler-sfc` produces and splice the
same attribute in. Everything downstream of the attribute (widget, `/__pinagent`
middleware, screenshots, `@pinagent/agent-runner`, SQLite, MCP) is
framework-agnostic and needs **zero** changes.

## What lives here

- **`transform.ts`** — `transformVue(code, { relPath })`. Parses the SFC with
  `@vue/compiler-sfc`, walks the `<template>` AST (descending through `v-if`
  branches and `v-for` bodies), and splices `data-pa-loc` after each element's
  tag name. Returns the rewritten source, or `null` when there's nothing to tag
  (no template, no elements, or an unparseable file) — the same "null means
  skip" contract as the babel plugin, so bundler glue can treat both
  identically.
- **`vite.ts`** (`@pinagent/vue-plugin/vite`) — a minimal Vite plugin,
  `vitePlugin()`, that runs `transformVue` on `.vue` files. It uses
  `enforce: 'pre'` so it tags the **raw** SFC source before `@vitejs/plugin-vue`
  compiles it; plugin-vue then re-parses the tagged source, so the attributes
  flow through to the compiled template. Dev-only (`command === 'serve'`),
  matching Pinagent's "production builds are untouched" invariant. This is a
  demonstration of the bundler glue, not the full integration — it does not yet
  inject the widget or the `/__pinagent` middleware.
- **`index.ts`** — public surface: `transformVue`, `TransformOptions`.

### End-to-end demonstration

`tests/vite.test.ts` spins up a real Vite dev server with `vitePlugin()` ahead
of `@vitejs/plugin-vue`, SSR-renders `tests/fixtures/App.vue`, and asserts the
rendered DOM carries the attributes. The actual output:

```html
<main data-pa-loc="App.vue:9:3" class="demo">
  <h1 data-pa-loc="App.vue:10:5">Pinagent Vue demo</h1>
  <button data-pa-loc="App.vue:11:5">Count is 0</button>
  <ul data-pa-loc="App.vue:12:5">
    <li data-pa-loc="App.vue:13:7">Apples</li>
    <li data-pa-loc="App.vue:13:7">Pears</li>
  </ul>
  <p data-pa-loc="App.vue:16:5">not yet</p>
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

The attribute carries a POSIX-relative `file:line:col`. Vue's SFC compiler
reports element locations relative to the **whole file** (not the template
block) and columns are already 1-indexed pointing at the `<`, which matches the
convention the babel plugin normalises JSX columns to — so the two transforms
emit identical attribute shapes.

## Where this fits

A full Vue integration would reuse almost everything that already exists:

| Layer | Source | Reuse |
|---|---|---|
| Source tagging | **this package** | new — the only Vue-specific work |
| Bundler glue (Vite plugin / Nuxt module) | adapt `@pinagent/vite-plugin` | call `transformVue` for `.vue` files, `transformJsx` for `.tsx` |
| Widget injection | `@pinagent/widget` | as-is (vanilla JS, no React) |
| Feedback API + WebSocket | `@pinagent/vite-plugin` middleware / Nuxt Nitro routes | ~copy-paste |
| Agent runtime, DB, MCP | `@pinagent/agent-runner`, `@pinagent/db`, `@pinagent/mcp` | as-is |

The natural next step is a Vite plugin that dispatches on file extension —
`transformVue` for `*.vue`, the existing `transformJsx` for `*.tsx` — which
covers both Vue + Vite apps and (with a Nuxt module wrapper) Nuxt.

## Build & test

```bash
pnpm --filter @pinagent/vue-plugin build
pnpm exec vitest run packages/vue-plugin
```

Dual ESM + CJS under `dist/` via `tsdown`.

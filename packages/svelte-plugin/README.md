# @pinagent/svelte-plugin

> **Status: proof-of-concept.** This package proves out the one genuinely
> Svelte-specific piece of Pinagent — source-mapping Svelte component markup back
> to `file:line:col`. It is not yet wired into a Vite/SvelteKit dev server or
> shipped as an installable integration. See [Where this fits](#where-this-fits).

The Svelte analogue of [`@pinagent/babel-plugin`](../babel-plugin) (JSX) and
[`@pinagent/vue-plugin`](../vue-plugin) (Vue SFCs). It injects a
`data-pa-loc="file:line:col"` attribute (plus a `data-pa-comp` component name)
onto every element in a `.svelte` component at build time. The widget reads
these attributes when the user picks an element, so each comment anchors to the
exact source location and reports the component it lives in.

Svelte is the interesting case because its markup is neither JSX nor wrapped in a
`<template>` — it's the top-level content of the `.svelte` file in Svelte's own
template syntax, parsed by the Svelte compiler. So instead of walking a JSX AST
we parse with `svelte/compiler` and walk the markup fragment. Everything
downstream of the attribute (widget, `/__pinagent` middleware, screenshots,
`@pinagent/agent-runner`, SQLite, MCP) is framework-agnostic and needs **zero**
changes.

## What lives here

- **`transform.ts`** — `transformSvelte(code, { relPath })`. Parses the
  component with `svelte/compiler` (`modern: true` → the Svelte 5 AST), walks the
  markup fragment (descending through `{#if}` / `{#each}` / `{#await}` blocks),
  and splices `data-pa-loc` (and `data-pa-comp`) after each element's tag name.
  Returns the rewritten source, or `null` when there's nothing to tag (no
  elements, or an unparseable file) — the same "null means skip" contract as the
  babel and vue plugins, so bundler glue can treat all three identically. In
  Svelte a `.svelte` file *is* one component, so the enclosing component name is
  derived from the filename (`PriceCard.svelte` → `PriceCard`) and every element
  — including every `{#each}` instance — carries it, which is what lets
  downstream loop-instance disambiguation resolve to the right item.
- **`vite.ts`** (`@pinagent/svelte-plugin/vite`) — a minimal `vitePlugin()` that
  tags `.svelte` files. Runs with `enforce: 'pre'` so it rewrites the **raw**
  component before `@sveltejs/vite-plugin-svelte` compiles it; dev-only,
  honouring the "production builds are untouched" invariant. This is a
  demonstration of the bundler glue, not the full integration — it does not yet
  inject the widget or the `/__pinagent` middleware.
- **`index.ts`** — public surface: `transformSvelte`, `TransformOptions`.

### End-to-end demonstration

`tests/vite.test.ts` spins up a real Vite dev server with `vitePlugin()` ahead of
`@sveltejs/vite-plugin-svelte`, SSR-renders `tests/fixtures/App.svelte`, and
asserts the rendered DOM carries the attributes — e.g.
`<main data-pa-loc="App.svelte:6:1" data-pa-comp="App">`, with both `{#each}`
`<li>` instances sharing one `data-pa-loc` + `data-pa-comp`.

## What it skips

- Components with no elements — quick prefilter avoids parsing.
- `<slot>` and `<svelte:*>` specials — compiler constructs, not real anchorable
  DOM. Native elements and `PascalCase` components are tagged; the walker still
  descends into specials so their *children* are tagged.
- Elements that already carry `data-pa-loc` — idempotent, safe to re-run.
- Files that fail to parse — returns `null` rather than crashing the build.

Svelte AST nodes report a character `start` offset (at the `<`); the column is
computed from it as 1-indexed-at-`<`, matching the convention the babel plugin
normalises JSX columns to and the one Vue's SFC parser reports — so the three
transforms emit identical attribute shapes (`data-pa-loc` + `data-pa-comp`).

## Where this fits

A full Svelte integration would reuse almost everything that already exists:

| Layer | Source | Reuse |
|---|---|---|
| Source tagging | **this package** | new — the only Svelte-specific work |
| Bundler glue (Vite plugin / SvelteKit) | adapt `@pinagent/vite-plugin` | call `transformSvelte` for `.svelte`, `transformVue` for `.vue`, `transformJsx` for `.tsx` |
| Widget injection | `@pinagent/widget` | as-is (vanilla JS, no React) |
| Feedback API + WebSocket | `@pinagent/vite-plugin` middleware | ~copy-paste |
| Agent runtime, DB, MCP | `@pinagent/agent-runner`, `@pinagent/db`, `@pinagent/mcp` | as-is |

The natural next step is folding `transformSvelte` into `@pinagent/vite-plugin`'s
extension dispatch (it already handles `*.vue` and `*.tsx`) — which covers Svelte
+ Vite apps and (with a SvelteKit wrapper) SvelteKit.

## Build & test

```bash
pnpm --filter @pinagent/svelte-plugin build
pnpm exec vitest run packages/svelte-plugin
```

Dual ESM + CJS under `dist/` via `tsdown`.

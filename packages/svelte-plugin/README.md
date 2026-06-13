# @pinagent/svelte-plugin

> **Status: shipped — internal, not installable.** This package is the home of
> Pinagent's one genuinely Svelte-specific piece: source-mapping Svelte
> component markup back to `file:line:col`. It is `private: true` (never
> published) and is bundled into [`@pinagent/vite-plugin`](../vite-plugin) at
> build time as an internal devDependency. **Svelte support already ships** —
> `@pinagent/vite-plugin`'s transform dispatch calls `transformSvelte` for
> `.svelte` files, and [`examples/sveltekit-app`](../../examples/sveltekit-app)
> runs the full click→comment→agent loop on it today. See
> [Where this fits](#where-this-fits) for how users get the feature.

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
- **`vite.ts`** (`@pinagent/svelte-plugin/vite`) — a standalone `vitePlugin()`
  that tags `.svelte` files. Runs with `enforce: 'pre'` so it rewrites the
  **raw** component before `@sveltejs/vite-plugin-svelte` compiles it; dev-only,
  honouring the "production builds are untouched" invariant. It tags only — it
  doesn't inject the widget or the `/__pinagent` middleware. In practice you
  don't use it directly: `@pinagent/vite-plugin` calls `transformSvelte`
  in-process (see [Where this fits](#where-this-fits)) and ships the widget +
  middleware alongside, so the whole loop comes from one plugin.
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

Svelte support is shipped, layered on top of the framework-agnostic rest of
Pinagent. The only Svelte-specific code is the transform in this package;
everything below it is reused as-is:

| Layer | Source | How |
|---|---|---|
| Source tagging | **this package** | the only Svelte-specific work — `transformSvelte` |
| Bundler glue (Vite / SvelteKit) | `@pinagent/vite-plugin` | its transform hook dispatches on extension: `transformSvelte` for `.svelte`, `transformVue` for `.vue`, `transformJsx` for `.tsx` (`vite-plugin/src/index.ts`) |
| Widget injection | `@pinagent/widget` | embedded in `@pinagent/vite-plugin` (vanilla JS, no React) |
| Feedback API + WebSocket | `@pinagent/vite-plugin` middleware | as-is |
| Agent runtime, DB, MCP | `@pinagent/agent-runner`, `@pinagent/db`, `@pinagent/mcp` | as-is |

**How users get it.** SvelteKit's bundler *is* Vite, so a Svelte or SvelteKit
app adds `@pinagent/vite-plugin` directly — no Svelte-specific wrapper needed.
The plugin tags `.svelte` files (alongside `.vue` and `.tsx`), injects the
widget, and mounts the `/__pinagent` middleware. See
[`examples/sveltekit-app`](../../examples/sveltekit-app) for a working end-to-end
setup, and the root [README](../../README.md) for the install snippet.

This package stays `private: true` on purpose: publishing the transform
standalone has no consumer story — every user reaches it through
`@pinagent/vite-plugin`, which bundles it. The decision is settled; this isn't
unfinished work.

## Build & test

```bash
pnpm --filter @pinagent/svelte-plugin build
pnpm exec vitest run packages/svelte-plugin
```

Dual ESM + CJS under `dist/` via `tsdown`.

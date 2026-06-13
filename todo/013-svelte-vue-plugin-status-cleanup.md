# 013 — svelte-plugin / vue-plugin: stale README + status cleanup

- **Priority:** P3 (docs-only; misleads contributors today)
- **Packages:** `@pinagent/svelte-plugin`, `@pinagent/vue-plugin` (both `private: true`)
- **Zone:** Apache-2.0
- **Changeset:** not required (private packages; docs-only)
- **Read `/todo/README.md` ground rules first**

## Context

Both packages' READMEs describe their own integration as future work that has in fact
shipped — inside `@pinagent/vite-plugin`:

- `packages/svelte-plugin/README.md:1-7` calls itself a "proof-of-concept… not yet wired
  into a Vite/SvelteKit dev server", and `:78-80` says folding `transformSvelte` into
  vite-plugin's extension dispatch is "the natural next step". That dispatch already exists
  (`packages/vite-plugin/src/index.ts:309-328`), and `examples/sveltekit-app` runs the full
  loop on it today.
- `packages/vue-plugin/README.md:86-94` likewise frames vite-plugin dispatch + "a Nuxt
  module wrapper" as future. The Nuxt module shipped (`packages/nuxt-plugin`) and it wraps
  **vite-plugin directly** — it does not consume `@pinagent/vue-plugin` at all.

Net effect: a contributor (or agent) reading these READMEs concludes Svelte/Vue support
doesn't exist, or starts building a duplicate integration. The audit that produced this
ticket initially mis-classified both as gaps for exactly this reason.

## Expected behavior

Each README states the true status in its first paragraph; the repo has one consistent
description of how Svelte/Vue/Nuxt support is layered.

## Implementation notes

1. Rewrite both READMEs' status framing:
   - What the package IS: the home of the `transformSvelte`/`transformVue` source-tagging
     transforms + their tests; `private: true`, bundled into vite-plugin at build time
     (internal devDependency — `packages/vite-plugin/package.json`), **not installable**.
   - How users actually get the feature: Svelte/SvelteKit and Vue SPAs → `@pinagent/vite-plugin`
     directly (SvelteKit's bundler IS vite — no wrapper needed); Nuxt → `@pinagent/nuxt-plugin`
     (which wraps vite-plugin, not vue-plugin).
   - Delete/replace the "natural next step" sections with pointers to the shipped dispatch
     (`vite-plugin/src/index.ts` transform hook) and the examples
     (`examples/sveltekit-app`, and `examples/vue-vite` once ticket
     [012](012-vue-vite-example.md) lands — phrase so it doesn't break if 012 lands later).
2. Check the **root `README.md`** integration list mentions Svelte and Vue support via
   vite-plugin (and Nuxt via nuxt-plugin); align wording if missing or stale.
3. Leave `private: true` and the devDependency wiring as-is — that's the decided packaging
   (publishing them standalone has no consumer story). State the decision in the README so
   it reads as intentional rather than unfinished.

## Acceptance criteria

- [ ] Neither README claims the vite-plugin integration is future work; both name the real
      consumer path (vite-plugin / nuxt-plugin) in the opening section.
- [ ] vue-plugin README no longer implies nuxt-plugin depends on it.
- [ ] Root README's framework support list is accurate.
- [ ] No code, packaging, or export changes; `pnpm lint` green.

## Out of scope

- Publishing either package, moving the transforms into vite-plugin's source tree, or any
  refactor — docs only.

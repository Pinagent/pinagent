# 012 — examples: Vue + Vite example app

- **Priority:** P3
- **Packages:** new `examples/vue-vite` (workspace member)
- **Zone:** Apache-2.0 — SPDX header on line 1 of every source file (examples are in scope)
- **Changeset:** none for the app itself, **but** add the new package name (e.g.
  `vue-vite-example`) to the `ignore` list in `.changeset/config.json` like the other
  examples
- **Read `/todo/README.md` ground rules first**

## Context

`@pinagent/vite-plugin` tags Vue SFCs natively — the transform dispatch handles `.vue`
before `@vitejs/plugin-vue` compiles them (`packages/vite-plugin/src/index.ts:309-328`,
`transformVue`), and unit tests cover it (`packages/vite-plugin/tests/vue-transform.test.ts`).
But the examples matrix is `react-vite`, `next-app`, `nuxt-app`, `sveltekit-app`,
`expo-app` — **no plain Vue + Vite app**. Svelte's standalone-Vite story has an example;
Vue's only example is Nuxt. That means the Vue-SPA path (the one a non-Nuxt Vue dev would
copy) has no runnable reference and no spot in the manual-test rotation.

## Expected behavior

`examples/vue-vite` exists, mirrors `examples/react-vite` in shape and size, and exercises
the full click→comment→agent loop on a Vue 3 SPA: SFC elements carry `data-pa-loc`, the
widget mounts, feedback POSTs, inline agent streams back.

## Implementation notes

1. **Mirror `examples/react-vite`** — same minimal structure (a couple of components, a
   list rendering to show loop-instance anchoring), `pinagent()` first in `plugins` before
   `@vitejs/plugin-vue` (the plugin is `enforce: 'pre'`, but keep the conventional order the
   other examples use), workspace deps via `workspace:*` like react-vite does.
2. **Workspace + turbo:** add as a pnpm workspace member (check `pnpm-workspace.yaml`
   globs — `examples/*` is likely already covered; the standalone-by-design exception is
   only `expo-app`). **No `prebuild` script that nests turbo** — rely on turbo `^build`
   (a nested `turbo run build` inside the outer turbo caused flaky CI before, PR #293).
3. Name it `vue-vite-example` (matches `react-vite-example` convention) and add to
   `.changeset/config.json` `ignore`.
4. Port: pick one not used by the other examples (react-vite is 5173, sveltekit/nuxt/next
   have theirs) and note it in the example README.
5. Keep `package.json` scripts aligned with react-vite (`dev`, `build`); confirm
   `pnpm lint`/`lint:spdx`/`lint:deps` (sherif) pass with the new member.

## Acceptance criteria

- [ ] `pnpm install && pnpm build` from root succeeds with the new member;
      `pnpm --filter vue-vite-example dev` serves the app.
- [ ] Rendered Vue elements carry `data-pa-loc` pointing at `.vue` source lines; pick →
      comment → submit creates a row in `.pinagent/db.sqlite` and (inline mode) streams an
      agent run in the widget.
- [ ] CI lint gates green: `lint:spdx`, `lint:deps`, `lint:workspace-deps`.
- [ ] `.changeset/config.json` ignore updated.

## Test plan

No unit tests in examples (matches the other example apps). The deliverable is the runnable
loop; verify manually per acceptance criteria. The Vue *transform* correctness is already
unit-tested in vite-plugin.

## Out of scope

- A separate `@pinagent/vue-plugin` consumer package (the standalone package stays an
  internal transform home — see ticket [013](013-svelte-vue-plugin-status-cleanup.md)).
- Dock walkthrough in the example (keep it minimal like react-vite).

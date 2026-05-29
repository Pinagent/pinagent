---
"@pinagent/cli": minor
---

`pinagent init` now detects and scaffolds SvelteKit projects. SvelteKit is
recognized via the `@sveltejs/kit` dependency (checked ahead of `vite.config.*`,
since SvelteKit runs Vite under the hood) and wired up with the Vite plugin —
there's no dedicated package, because SvelteKit is Vite-native. `init` sets up
`.gitignore` + `.mcp.json` and prints the SvelteKit-specific steps: add
`pinagent()` to `vite.config` ahead of `sveltekit()`, and inject the widget via
a dev-only `transformPageChunk` in `src/hooks.server.ts`. A plain Svelte + Vite
app (no `@sveltejs/kit`) stays on the `vite` path, where the widget auto-injects.

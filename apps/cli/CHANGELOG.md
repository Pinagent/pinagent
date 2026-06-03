# @pinagent/cli

## 0.2.4

### Patch Changes

- Updated dependencies [ec33fdd]
- Updated dependencies [13e2636]
- Updated dependencies [2989bbb]
- Updated dependencies [8ba03fc]
  - @pinagent/mcp@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [f5fa586]
- Updated dependencies [678bb53]
- Updated dependencies [dbb238d]
  - @pinagent/mcp@0.3.0

## 0.2.2

### Patch Changes

- 4d67048: `pinagent doctor` now nudges toward registering the MCP server at the monorepo root: it detects the workspace root (pnpm-workspace.yaml / `workspaces` field / lerna.json) and warns when `.mcp.json` is buried inside an app instead, and points the "no .mcp.json found" hint at the repo root in a monorepo.

## 0.2.1

### Patch Changes

- Updated dependencies [b8c67f8]
  - @pinagent/mcp@0.2.1

## 0.2.0

### Minor Changes

- Add `pinagent doctor` — a read-only command that verifies pinagent is wired into a project correctly. It checks plugin and subpath (`./config`, `./route`) resolution, that the runtime config is wrapped with `pinagent(...)`, that `<Pinagent />` is mounted and the route handler is correct (Next), that `.pinagent` is gitignored, that `.mcp.json` registers the server and any `PINAGENT_PROJECT_ROOT` points at a real directory, and that no dangling `@pinagent/*` symlinks linger in `node_modules`. Exits non-zero if any check fails.
- 86d277e: `pinagent init` now detects and scaffolds Nuxt projects. A `nuxt.config.*` is
  recognized as the `nuxt` runtime (checked ahead of `vite.config.*`, since Nuxt
  runs Vite under the hood), wires up `.gitignore` + `.mcp.json` the same way, and
  prints the Nuxt-specific manual step (add `@pinagent/nuxt-plugin` to the
  `modules` array). No route handler is needed — the Nuxt module wires everything.
- c2a2296: `pinagent init` now detects and scaffolds SvelteKit projects. SvelteKit is
  recognized via the `@sveltejs/kit` dependency (checked ahead of `vite.config.*`,
  since SvelteKit runs Vite under the hood) and wired up with the Vite plugin —
  there's no dedicated package, because SvelteKit is Vite-native. `init` sets up
  `.gitignore` + `.mcp.json` and prints the SvelteKit-specific steps: add
  `pinagent()` to `vite.config` ahead of `sveltekit()`, and inject the widget via
  a dev-only `transformPageChunk` in `src/hooks.server.ts`. A plain Svelte + Vite
  app (no `@sveltejs/kit`) stays on the `vite` path, where the widget auto-injects.

### Patch Changes

- a389780: `pinagent init` now generates the Next.js route handler with `export * from '@pinagent/next-plugin/route'` instead of a fixed verb list. This re-exports exactly the HTTP handlers the installed plugin provides, so the route stops breaking with "Export DELETE doesn't exist in target module" when the plugin version's handler set differs from the template. `dynamic`/`runtime` stay inline (Next won't follow re-exports for route-segment config).

## 0.1.0

### Minor Changes

- 99a1519: Publish `@pinagent/cli` and fix `@pinagent/mcp` packaging.

  `@pinagent/mcp@0.1.0` was uninstallable from npm: it declared the private,
  unpublished `@pinagent/db` (and `@pinagent/shared`) as runtime `dependencies`,
  so a clean `npm install @pinagent/mcp` failed with a 404 on `@pinagent/db`.
  Those internal packages now live in `devDependencies` so tsdown bundles them
  into the published dist (the same pattern `@pinagent/vite-plugin` and
  `@pinagent/next-plugin` already use). A clean install now resolves with no
  dangling internal dependencies.

  `@pinagent/cli` becomes publishable (was `private`): it adds
  `publishConfig.access: public` and a `prepare` build hook, keeps a thin runtime
  dependency on `@pinagent/mcp`, and bundles `@pinagent/shared`. This makes
  `pnpm dlx @pinagent/cli mcp` (and `pinagent init` / `pinagent transcript`)
  work without a local checkout.

### Patch Changes

- Updated dependencies [cf3dc7e]
- Updated dependencies [99a1519]
  - @pinagent/mcp@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [8c028bf]
  - @pinagent/mcp@0.1.0

## 0.0.1

### Patch Changes

- Updated dependencies [6520e38]
  - @pinagent/mcp@0.0.2

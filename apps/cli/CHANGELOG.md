# @pinagent/cli

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

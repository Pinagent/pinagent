---
"@pinagent/widget-dock": minor
---

Publish the dock UI package. It was previously `private`/unpublished, but `@pinagent/next-plugin` and `@pinagent/vite-plugin` resolve it at runtime via `require.resolve('@pinagent/widget-dock')` to serve the `dock: true` iframe — so the published plugins referenced `@pinagent/widget-dock@0.0.0`, which 404'd on install. It now publishes as a zero-runtime-dep static-asset package (its deps are bundled into `dist/` by the Vite app build).

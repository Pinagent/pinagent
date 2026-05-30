---
"@pinagent/widget-dock": minor
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

Publish `@pinagent/widget-dock` so the optional `dock: true` surface resolves for npm consumers.

Both plugins resolve `@pinagent/widget-dock` at runtime (`require.resolve('@pinagent/widget-dock/package.json')`) to serve the dock's static assets, and declare it in `dependencies`. But the package was `private: true` and never published — so a clean `npm i @pinagent/next-plugin` (0.2.0) / `@pinagent/vite-plugin` (0.3.0) 404'd trying to fetch `@pinagent/widget-dock@0.0.0`. The core install was broken out of the box.

`@pinagent/widget-dock` is now published. Its build (`vite build`) bundles everything into a self-contained static `dist/`, so it ships with **no** runtime dependencies — react, the TanStack packages, and the internal `@pinagent/*` packages (which are themselves unpublished) moved to `devDependencies`. A new `lint:published-deps` CI gate now fails if any published package lists a private/unpublishable workspace package in `dependencies`, so this class of broken-install can't ship again.

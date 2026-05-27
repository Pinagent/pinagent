---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Inline `@pinagent/*` workspace packages into the published `next-plugin`
and `vite-plugin` tarballs so end users don't need workspace packages
available at install time. Workspace deps moved to `devDependencies`;
the npm-shaped transitive deps (`@anthropic-ai/claude-agent-sdk`,
`@babel/*`, `better-sqlite3`, `drizzle-orm`, `ws`, `zod`, `nanoid`) are
declared as runtime `dependencies` on the consumer plugins. Verified by
inspecting the built CJS bundles: no more `require("@pinagent/...")`
calls in `dist/route.cjs` or `dist/index.cjs`.

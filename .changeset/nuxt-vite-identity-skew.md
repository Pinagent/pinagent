---
"@pinagent/nuxt-plugin": patch
---

fix(nuxt-plugin): make the `addVitePlugin` call resilient to `vite` type-identity skew

`@nuxt/kit`'s `addVitePlugin` is typed against the `vite` *it* resolves, while
`pinagent()` returns a `Plugin` typed against the `vite` `@pinagent/vite-plugin`
resolves. pnpm peer-deduping routinely produces two `vite` instances — same
version, different peer hash (e.g. one hashed against `@types/node@x.y.1`, the
other `@types/node@x.y.3`) — whose structurally identical `Plugin<any>` types are
nominally unrelated, so `tsc` rejected the call with TS2345. Any lockfile re-hash
(every Dependabot bump) could flip which instance each side gets, breaking
`pnpm typecheck` on the nuxt-plugin even though the runtime object is a valid vite
plugin. The call now casts to `addVitePlugin`'s own parameter type, decoupling it
from the resolved `vite` identity without pinning `vite` across the workspace.

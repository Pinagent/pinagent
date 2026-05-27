---
'@pinagent/vite-plugin': patch
---

Widen the `vite` peer-dependency range from `^5 || ^6 || ^7` to
`^5 || ^6 || ^7 || ^8` so fresh installs on the current Vite major
don't trip a peer-dep warning. The plugin's Vite-API surface
(plugin object, `configureServer`, `transform`) hasn't changed
between major versions in a way that breaks us.

Also: the root README's install section now mentions
`pnpm approve-builds` for the `better-sqlite3` native build,
since pnpm 10+ blocks postinstall scripts by default.

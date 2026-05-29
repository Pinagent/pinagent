---
"@pinagent/cli": minor
---

`pinagent init` now detects and scaffolds Nuxt projects. A `nuxt.config.*` is
recognized as the `nuxt` runtime (checked ahead of `vite.config.*`, since Nuxt
runs Vite under the hood), wires up `.gitignore` + `.mcp.json` the same way, and
prints the Nuxt-specific manual step (add `@pinagent/nuxt-plugin` to the
`modules` array). No route handler is needed — the Nuxt module wires everything.

---
"@pinagent/cli": patch
---

`pinagent init` now generates the Next.js route handler with `export * from '@pinagent/next-plugin/route'` instead of a fixed verb list. This re-exports exactly the HTTP handlers the installed plugin provides, so the route stops breaking with "Export DELETE doesn't exist in target module" when the plugin version's handler set differs from the template. `dynamic`/`runtime` stay inline (Next won't follow re-exports for route-segment config).

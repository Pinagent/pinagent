---
"@pinagent/next-plugin": patch
---

Warn loudly on unsupported deployment shapes. `pinagent()` now emits one
grep-able `[pinagent]` `console.warn` at dev-server start when `basePath` or
`assetPrefix` is set in the Next config — pinagent's widget and all
`/__pinagent/*` endpoints are served from root-absolute paths and don't honor
either, so the widget would otherwise 404 silently. The check is exported as a
pure `shouldWarnDeploymentShape` predicate. The README gains three sections
covering `basePath`/`assetPrefix` (unsupported), the `middleware.ts` matcher
exclusion (`matcher: ['/((?!__pinagent).*)']`), and the App-Router-required
stance for the route mount.

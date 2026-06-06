---
"@pinagent/cli": patch
---
`pinagent doctor`: flag existing Next middleware/proxy that shadows the
`/__pinagent/*` rewrite. Middleware runs before `next.config` rewrites, so a
broad catch-all `matcher` (next-intl, NextAuth/Clerk, geo/redirect middleware)
intercepts and mangles `/__pinagent/*` before the rewrite resolves and every
pinagent endpoint 404s — silently. Doctor now detects a `middleware`/`proxy`
file (repo root or `src/`, both `.ts`/`.js`) and warns when its matcher is
broad enough to bite without excluding `__pinagent`/`pinagent`.

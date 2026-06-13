---
"@pinagent/next-plugin": patch
---

Narrow the Turbopack tagging-loader rule from `*.{ts,tsx,js,jsx}` to
`*.{tsx,jsx}`, matching the webpack rule (`/\.(t|j)sx$/`) and the Vite
reference. The loader bails internally on non-JSX so output is byte-identical,
but the wider glob round-tripped every `.ts`/`.js` module through a JS loader
for nothing — measurable on large apps. This realigns Turbopack's pipeline
scoping with webpack's.

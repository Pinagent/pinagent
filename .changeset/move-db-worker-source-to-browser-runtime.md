---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Move `db-worker-source.ts` (the SQLite-WASM Web Worker source string) out
of `@pinagent/agent-runner` and into `@pinagent/browser-runtime`, where it
fits architecturally — the file is browser-side code, not agent runtime.
`@pinagent/next-plugin/route` now imports `DB_WORKER_SOURCE` from
`@pinagent/browser-runtime`; no externally observable change.

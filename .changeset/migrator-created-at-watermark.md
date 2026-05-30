---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

fix(db): don't re-run migrations on DBs created by an earlier build

The bundled migrator now decides "already applied?" by the
`__drizzle_migrations.created_at` watermark (drizzle's own semantics, and
what the browser-side mirror already does) instead of matching the stored
`hash` value. An earlier Pinagent build wrote the migration *tag* into the
`hash` column rather than `sha256(rawSql)`; keying on the hash value treated
those rows as unknown, re-ran migration 0000, and crashed with
`table active_runs already exists` — 500-ing every `POST /__pinagent/feedback`
and silently blocking the agent. Such legacy DBs now upgrade cleanly in place.

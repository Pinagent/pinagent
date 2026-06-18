---
"@pinagent/react-native": patch
---

fix(react-native): ship the drizzle migrations so the dev server can create its DB

`@pinagent/react-native`'s `server` build bundles the agent-runner DB layer,
which probes `<pkg>/drizzle` (then `@pinagent/db/drizzle`) for the SQL
migrations at first connect. But unlike `@pinagent/next-plugin` and
`@pinagent/vite-plugin`, the react-native package never ran the
`copy-drizzle.mjs` prebuild and never listed `drizzle` in `files`, so the
published tarball shipped the migration *runner* and the bundled *schema* but
none of the migration `.sql` files. `@pinagent/db` is `private` and
unpublished, so the runtime's fallback candidates didn't resolve either.

The result on every consumer (e.g. an Expo/Metro app): Metro spam of
`[pinagent:db] no migrations dir at …/@pinagent/react-native/drizzle; skipping
migrate()`, and because the skip path still runs `DELETE FROM active_runs`
against a never-created table, `getDb()` throws before it can cache — so the
warning repeats on every feedback/WS event and the feedback DB is effectively
dead.

Mirror the next/vite plugins: add `scripts/copy-drizzle.mjs`, wire it as
`prebuild`, add `@pinagent/db` as a dev dependency, and include `drizzle` in
`files`. The migration source of truth stays `packages/db/drizzle/`; the copied
dir is gitignored.

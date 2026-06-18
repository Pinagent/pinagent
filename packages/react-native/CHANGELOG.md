# @pinagent/react-native

## 0.1.3

### Patch Changes

- cf561d2: fix(react-native): ship the drizzle migrations so the dev server can create its DB

  `@pinagent/react-native`'s `server` build bundles the agent-runner DB layer,
  which probes `<pkg>/drizzle` (then `@pinagent/db/drizzle`) for the SQL
  migrations at first connect. But unlike `@pinagent/next-plugin` and
  `@pinagent/vite-plugin`, the react-native package never ran the
  `copy-drizzle.mjs` prebuild and never listed `drizzle` in `files`, so the
  published tarball shipped the migration _runner_ and the bundled _schema_ but
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

## 0.1.2

### Patch Changes

- 44456a1: fix(react-native): resolve strict-mode type errors in shipped native source

  `src/native/` ships to consumers as TypeScript source for their Metro/TS
  toolchain to compile, so type errors there surface in strict consumer
  projects. Tighten the types in `transcript.ts` and `transport.ts` so the
  shipped source typechecks cleanly under `strict: true`. (Releases the fix
  landed in #439, which merged without a changeset.)

## 0.1.0

### Minor Changes

- 6ae0bd3: feat(react-native): publish `@pinagent/react-native` to npm

  Promote the React Native / Expo plugin to a published package, alongside
  `@pinagent/vite-plugin` and `@pinagent/next-plugin`. Apps can now
  `npm i @pinagent/react-native` instead of vendoring the source.
  - Drop `private: true`; add `publishConfig.access: "public"`, `repository`,
    `keywords`, and `homepage`.
  - Re-declare `react`, `react-native`, and `react-native-view-shot` as
    **optional** `peerDependencies` (the consumer's app provides them; the
    native client ships as source for Metro to transpile). Optional keeps the
    web-first monorepo install green under `strictPeerDependencies`.
  - Move `@pinagent/agent-runner` (unpublishable) from `dependencies` to
    `devDependencies` so tsdown bundles it into `dist/server.*`, and declare
    the external runtime deps the bundle reaches (`@anthropic-ai/claude-agent-sdk`,
    `drizzle-orm`, `nanoid`, `ws`, `zod`) — mirroring the vite/next plugins so a
    clean `npm install` of the tarball resolves everything.

  Published surface: `@pinagent/react-native` (native `<Pinagent/>` widget,
  shipped as source), `@pinagent/react-native/server` (Metro middleware),
  `@pinagent/react-native/babel` (source-tagging Babel plugin).

---
"@pinagent/react-native": minor
---

feat(react-native): publish `@pinagent/react-native` to npm

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

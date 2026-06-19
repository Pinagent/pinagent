# @pinagent/react-native

## 0.2.0

### Minor Changes

- 8fb93dc: feat(react-native): make the feedback FAB draggable

  The 💬 floating action button can now be dragged anywhere on screen, so it
  can be moved off whatever control the developer wants to comment on. A single
  PanResponder discriminates a stationary tap (still arms picking) from a drag
  (relocates the button), the position stays clamped on-screen across rotations,
  and it resets to the bottom-right corner on reload (RN keeps no device store).

### Patch Changes

- d751150: fix(react-native): re-anchor onto a real source location when pressing any breadcrumb

  Previously only the initially-tapped (innermost) breadcrumb showed a `file:line`
  path; pressing an ancestor crumb to switch focus often fell back to a bare
  component name. The tapped element resolved its location via `pickLoc`'s
  owner-hierarchy walk, but per-crumb locations were read from each crumb's own
  host props with no fallback, so an ancestor whose first host child is untagged
  collapsed to `loc: null`. Each crumb now re-resolves to the nearest source in
  the hierarchy (descendants first, then ancestors), so re-focusing onto any
  breadcrumb anchors the comment — and the "open in editor" link — onto the actual
  code snippet.

## 0.1.4

### Patch Changes

- 65234d3: fix(react-native): resolve taps to the call site, not the wrapper, for generic components

  The Babel source-tagging plugin appended its `data-pa-loc` / `data-pa-comp`
  attributes _after_ an element's existing attributes. For a generic wrapper
  component that forwards props onto a host view — `const View = (props) =>
<ViewRn {...props} />`, the dominant pattern in real RN/Expo apps — the
  forwarded call-site `data-pa-loc` (which arrives through `{...props}`) was
  overridden by the wrapper's own spliced attribute, because JSX props are
  last-wins and the spliced one came last. Every element rendered through the
  wrapper therefore collapsed to the wrapper's own `file:line` (e.g.
  `src/components/view/view.tsx:14`), so tapping a child in the in-app picker
  only ever resolved to the wrapper — the specific element the developer tapped
  was unreachable.

  Prepend the attributes instead, so a forwarded `data-pa-loc` overrides the
  wrapper's own and the host view resolves to the actual call site. This matches
  the web `@pinagent/babel-plugin`, which already inserts at the element name
  (before any `{...spread}`). Adds the RN plugin's first unit tests.

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

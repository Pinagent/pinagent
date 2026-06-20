# @pinagent/react-native

## 0.2.4

### Patch Changes

- fae681f: fix(react-native): resolve taps inside react-native-pager-view (and other native-hosted content) via a measure fallback

  Tapping a widget on a screen rendered through `react-native-pager-view` (e.g. a
  `MaterialTopTabs` pager) selected a full-screen wrapper instead of the element
  under the finger — RN's **own** built-in inspector hits the same wall. The
  pager hosts each page's views in a native container (UIPageViewController),
  which detaches them from the Fabric shadow tree that
  `getInspectorDataForViewAtPoint`'s geometric `findNodeAtPoint` walks, so the
  native hit-test bottoms out at the page's scene wrapper and never reaches the
  tagged widget.

  The React **fiber** tree is intact, though, and the widgets are on-screen and
  measurable. So when the native hit-test fails to land on a tagged element
  (`tappedLeafLoc` is null), `resolvePick` now falls back to a measure-based
  hit-test: it DFS-walks the fiber subtree under the touched host, calls
  `measureInWindow` on each host, and returns the deepest tagged host whose window
  frame contains the tap (pruned like `elementFromPoint`). The breadcrumb is
  rebuilt from that leaf's `data-pa-loc`/`data-pa-comp` ancestry.

  The fallback is gated on the native hit-test failing, so every screen that
  already resolved correctly keeps its exact existing path; the new code only runs
  for the previously-unreachable case. Pure traversal (`measureHitTest`,
  `taggedAncestors`, `frameContains`) is unit-tested with synthetic fiber trees;
  the `measureInWindow` bridge degrades to the prior behavior when unavailable.

## 0.2.3

### Patch Changes

- 37ce183: fix(react-native): resolve a tap to the leaf under the finger, not its parent

  Tapping a nested element in the in-app picker selected its parent container
  instead of the element actually touched. RN's `getInspectorDataForViewAtPoint`
  does not hand back the tapped host's props: `getInspectorDataForInstance` walks
  the **owner** tree up to the nearest non-host composite, then returns
  `getHostProps(thatComposite)` — its **first host descendant** (the component's
  outermost view) via `findCurrentHostFiber`. So a tap on, say, a card's content
  whose JSX owner is the screen layout resolved to the layout's outer `<View>`
  (e.g. `_layout.tsx:89`), and every leaf owned by that component collapsed to the
  same container.

  `pickLoc` now first reads the host actually under the finger — RN includes its
  public instance as `closestPublicInstance` in the payload — bridges it to its
  fiber and walks the render-tree parent (`return`) chain for the nearest
  `data-pa-loc`: the tapped element itself, or the nearest authored element
  enclosing it when that exact host is untagged. This mirrors the web widget
  walking up the DOM from the clicked node. `data.props` and the owner-hierarchy
  walk remain as fallbacks (e.g. Paper, which surfaces only a numeric view tag
  that can't be bridged).

## 0.2.2

### Patch Changes

- d40d9a8: fix(react-native): give the native entry a `types` condition so consumers' `tsc` reads declarations, not our raw source

  The `"."` export shipped the native client as raw `.ts` (intentional — Metro
  needs the source) but had no `types` condition, so under
  `moduleResolution: bundler`/`node16` a consumer's TypeScript fell through to the
  `default` condition and type-checked our raw `src/native/**` source — surfacing
  our own type bugs as errors inside the consumer's build (`skipLibCheck` can't
  help, since these are `.ts`/`.tsx`, not `.d.ts`).

  The `"."` export now exposes a `types` condition (`./dist/native/index.d.ts`,
  ordered first) emitted by a declaration-only `tsc` pass over `src/native`, while
  the `react-native`/`default` conditions still resolve to the source for Metro.
  Net effect: `tsc` reads our declarations; Metro bundles the source — unchanged.

  Also fixes two genuine type bugs the strict source exposed (so the emitted
  declarations are correct), and wires `src/native` into the package's own
  `typecheck`/`build` (strict + `noUncheckedIndexedAccess`) so this class of bug
  is caught here instead of downstream:
  - `inspector.ts` `nearestLoc`: bind the indexed element to a local before
    returning it, so the narrowed value (not a fresh `… | undefined` re-access)
    is returned.
  - `pin-icon.tsx`: type the lazily-required `react-native-svg` `Svg`/`Path` as
    `ComponentType` rather than `unknown` (which is not a valid JSX element type).

## 0.2.1

### Patch Changes

- 6383996: feat(react-native): brand the widget FAB with the pinagent pin and colours

  The native floating action button showed a 💬 emoji on a neutral charcoal
  circle that turned blue while picking. It now renders the canonical pinagent
  pin mark (cream on the brand ink surface) and uses a gold ring for the active
  picking state — matching the web widget FAB.

  The pin is drawn with `react-native-svg` (added as an _optional_ peer, lazily
  required like `react-native-view-shot`, so release builds never pull it in).
  When the peer isn't installed the FAB falls back to a View-drawn teardrop in
  the same brand colour, so it always shows a pin rather than a generic glyph.

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

---
'@pinagent/react-native': patch
---

fix(react-native): give the native entry a `types` condition so consumers' `tsc` reads declarations, not our raw source

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

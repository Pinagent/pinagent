---
"@pinagent/react-native": patch
---

fix(react-native): resolve strict-mode type errors in shipped native source

`src/native/` ships to consumers as TypeScript source for their Metro/TS
toolchain to compile, so type errors there surface in strict consumer
projects. Tighten the types in `transcript.ts` and `transport.ts` so the
shipped source typechecks cleanly under `strict: true`. (Releases the fix
landed in #439, which merged without a changeset.)

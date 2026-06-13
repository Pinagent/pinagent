# 003 — next-plugin: route-noop verb parity (PUT/DELETE)

- **Priority:** P1 (production build breaker for fixed-list consumers; smallest ticket)
- **Packages:** `@pinagent/next-plugin` (`packages/next-plugin`)
- **Zone:** Apache-2.0
- **Changeset:** **required** — patch bump for `@pinagent/next-plugin`
- **Read `/todo/README.md` ground rules first**

## Context

The dev route handler exports five verbs — `GET`/`POST`/`PATCH`/`PUT`/`DELETE`
(`packages/next-plugin/src/route.ts:126,362,584,620,655`). The production stub that the
`"default"` exports condition swaps in only exports three
(`packages/next-plugin/src/route-noop.ts:19-21`):

```ts
export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
// PUT, DELETE missing
```

Consumers mount `app/pinagent/[[...slug]]/route.ts` re-exporting from
`@pinagent/next-plugin/route`. Two failure modes:

1. **Fixed-verb re-export** (the 0.1.0-era generated file did
   `export { GET, POST, PATCH, PUT, DELETE } from ...` — see repo history around the
   "Export DELETE doesn't exist" issue): dev compiles fine, **production build hard-fails**
   because the noop module has no `PUT`/`DELETE`.
2. **`export *` re-export** (current guidance): prod silently loses PUT/DELETE handling —
   those verbs fall through to Next's default 405 instead of the stub's inert 404. Minor,
   but an avoidable behavioral asymmetry.

## Expected behavior

`route-noop.ts` exports the exact same verb set as `route.ts`, and a test pins that parity
so the next verb added to `route.ts` can't drift.

## Implementation notes

1. Add to `route-noop.ts`:
   ```ts
   export const PUT = notFound;
   export const DELETE = notFound;
   ```
2. Add a parity test in `packages/next-plugin/tests/` (create the dir if absent; vitest
   auto-discovers `packages/*/tests`): import both modules
   (`../src/route` and `../src/route-noop`) and assert the set of exported HTTP-verb names
   (`GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS` intersection of `Object.keys`) is identical.
   Importing `src/route` pulls heavy deps but is test-time only; if import cost is a problem,
   parse exports statically instead — assert on names, not behavior.

## Acceptance criteria

- [ ] `route-noop.ts` exports `GET`, `POST`, `PATCH`, `PUT`, `DELETE`, all returning the
      inert 404 with `cache-control: no-store`.
- [ ] Parity test fails if either module gains/loses a verb the other lacks.
- [ ] `pnpm build && pnpm typecheck && pnpm test` green; changeset added (patch,
      `@pinagent/next-plugin`).

## Out of scope

- Adding `HEAD`/`OPTIONS` handlers to either module (audited, deliberately skipped —
  browsers don't preflight these same-origin dev requests).
- Touching the generated consumer `route.ts` template (already `export *` per #—history).

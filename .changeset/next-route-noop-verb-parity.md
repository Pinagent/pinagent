---
"@pinagent/next-plugin": patch
---

Add `PUT`/`DELETE` to the production route stub (`route-noop.ts`) so its
exported HTTP-verb set matches the dev route handler (`route.ts`).

The `"default"` package.json export condition swaps in `route-noop` for
production bundles, but it only exported `GET`/`POST`/`PATCH` while the dev
handler exports `GET`/`POST`/`PATCH`/`PUT`/`DELETE`. A consumer whose
generated `app/pinagent/[[...slug]]/route.ts` re-exported a fixed verb list
hard-failed the production build ("Export DELETE doesn't exist"); an
`export *` consumer silently dropped `PUT`/`DELETE` to Next's default 405
instead of the stub's inert 404. Both verbs now return the same no-store 404.
A parity test pins the export sets so a future verb added to `route.ts` can't
drift from the stub.

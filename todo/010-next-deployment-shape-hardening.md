# 010 — next-plugin: deployment-shape hardening (basePath warning + docs)

- **Priority:** P3
- **Packages:** `@pinagent/next-plugin` (`packages/next-plugin`)
- **Zone:** Apache-2.0
- **Changeset:** **required** — patch bump for `@pinagent/next-plugin` (adds a dev warning)
- **Read `/todo/README.md` ground rules first**

## Context

Three Next-specific app shapes silently break or confuse pinagent, none of which exist in
the Vite world (its middleware runs at the server root, ahead of the app):

1. **`basePath` / `assetPrefix`.** All client paths are hardcoded root-absolute:
   `<Pinagent />` injects `s.src = '/__pinagent/widget.js'`
   (`packages/next-plugin/src/component.tsx:44`) and the dock iframe
   `'/__pinagent/dock/embedded.html'` (`component.tsx:69`); the rewrite maps
   `'/__pinagent/:path*'` (`packages/next-plugin/src/config.ts`, rewrite block ~92-95);
   the widget's own fetches (`/__pinagent/feedback`, `/db-worker.js`, `/sqlite-wasm/*`)
   are root-absolute inside the embedded IIFE. With `basePath: '/app'`, every one of these
   404s — the failure is a blank widget with console noise, nothing actionable.
2. **`middleware.ts` interception.** `/__pinagent/*` requests flow through user middleware
   like any route; an auth/redirect middleware breaks the loop silently. The README mentions
   the fact (~line 127) but gives no mitigation.
3. **Pages router.** Docs and the example only show the app-router mount
   (`app/pinagent/[[...slug]]/route.ts`); the pages-router story is undocumented/untested.

## Expected behavior

Unsupported shapes fail *loudly and early* with actionable messages, and the README tells
users exactly how to coexist with `middleware.ts` and what the pages-router stance is.

## Implementation notes

1. **basePath warning (code):** `withPinagent(nextConfig)` (`config.ts`) sees the user
   config. In dev, when `nextConfig.basePath` or `nextConfig.assetPrefix` is set, emit one
   clear `console.warn` at config time: pinagent's `/__pinagent/*` endpoints don't honor
   basePath; the widget will not load; link to the README section. Don't attempt support
   (see Out of scope). Make the message grep-able: prefix `[pinagent]`.
2. **README — middleware.ts section:** show the standard matcher exclusion:
   ```ts
   export const config = {
     matcher: ['/((?!__pinagent).*)'],
   };
   ```
   plus a note for middlewares with custom matchers (just don't match `/__pinagent`).
3. **README — pages router:** decide and document the stance. Cheapest honest position:
   "app router required for the route mount" if that's true after inspection — the route
   handler file shape (`route.ts` verbs + route-segment config, `src/route.ts:126+`) is
   app-router-specific; verify whether a `pages/api` re-export could work before writing
   "unsupported". Document whichever is real; add a pages-router example only if it works
   with a trivial mount.
4. **README — basePath/assetPrefix:** unsupported, with the warning text quoted.

## Acceptance criteria

- [ ] Setting `basePath` in `examples/next-app`'s config prints exactly one `[pinagent]`
      warning at dev-server start (and nothing in production builds).
- [ ] README gains the three sections (basePath/assetPrefix, middleware.ts matcher, pages
      router) with copy-pasteable snippets.
- [ ] A unit test covers the warning trigger (pure function over a config object — make the
      check a small exported helper so it's testable without Next).
- [ ] Changeset (patch); `pnpm build && pnpm typecheck && pnpm test` green.

## Out of scope

- Actually supporting basePath (threading it through the component props, widget IIFE
  prelude, rewrite, and every fetch in the embedded widget — a cross-package change with a
  widget-cascade release; only worth it on real demand).
- OPTIONS/HEAD handlers (audited; not needed for same-origin dev requests).

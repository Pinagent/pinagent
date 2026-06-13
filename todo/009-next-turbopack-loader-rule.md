# 009 — next-plugin: narrow the Turbopack loader rule to JSX files

- **Priority:** P3 (dev-perf only, no correctness impact)
- **Packages:** `@pinagent/next-plugin` (`packages/next-plugin`)
- **Zone:** Apache-2.0
- **Changeset:** **required** — patch bump for `@pinagent/next-plugin`
- **Read `/todo/README.md` ground rules first**

## Context

The webpack path scopes the tagging loader to JSX files — `test: /\.(t|j)sx$/`
(`packages/next-plugin/src/config.ts`, ~line 204). The Turbopack rule matches every TS/JS
file (`config.ts:238-240`):

```ts
'*.{ts,tsx,js,jsx}': {
  loaders: ['@pinagent/next-plugin/loader'],
},
```

The loader bails internally on non-JSX, so output is correct, but under Turbopack every
`.ts`/`.js` module in the app round-trips through a JS loader for nothing — measurable on
large apps, and an asymmetry between the two bundlers' pipelines.

The vite reference scopes the same way as webpack: `/\.(t|j)sx$/`
(`packages/vite-plugin/src/index.ts:311`).

## Expected behavior

Turbopack invokes the pinagent loader only for `.tsx`/`.jsx` modules, byte-identical output,
matching webpack's scoping.

## Implementation notes

1. Change the rule key to `'*.{tsx,jsx}'` (brace expansion is already in use in this exact
   key, so the syntax is supported by the Next version in the examples).
2. **Do not touch the loader string** — the package-specifier-not-absolute-path constraint
   in the comment at `config.ts:232-237` is load-bearing for pnpm workspaces.
3. Preserve the spread of any user-supplied `config.turbopack.rules` (`config.ts:230-231`).
4. Sanity-check against the example: `pnpm --filter next-app-example dev` (Next dev defaults
   to Turbopack; verify whichever flag the example uses) — elements still carry
   `data-pa-loc`, and a plain `.ts` module edit no longer logs/loads through the pinagent
   loader (verify via a temporary loader log if needed, then remove it).

## Acceptance criteria

- [ ] Turbopack rule matches only `*.{tsx,jsx}`; webpack path untouched.
- [ ] `examples/next-app` under Turbopack still tags JSX (`data-pa-loc` present in rendered
      DOM) and the click→comment→agent loop works.
- [ ] Changeset (patch) added; `pnpm build && pnpm typecheck && pnpm test` green.

## Out of scope

- Tagging JSX inside `.ts`/`.js` files — TypeScript forbids JSX in `.ts`, and `.js`-with-JSX
  Next apps are out of pattern for this repo (webpack/vite already exclude them; this change
  aligns Turbopack with that existing decision, it doesn't make a new one).

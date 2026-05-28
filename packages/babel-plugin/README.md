# @pinagent/babel-plugin

Babel transform that injects a `data-pa-loc="file:line:col"` attribute onto every JSX opening element at build time. The widget reads this attribute when the user picks an element so each comment anchors to the exact source location, surviving DOM restructuring as long as the source line doesn't move.

Consumed by `@pinagent/vite-plugin` and `@pinagent/next-plugin` — adopters don't wire this plugin into their own babel config.

## What lives here

- **`transform.ts`** — `transformJsx(code, { relPath, ts })`. Parses with `@babel/parser`, walks `JSXOpeningElement` nodes, and adds the attribute when missing. Returns the rewritten source string, or `null` when the file contains no JSX (so callers can skip the write).
- **`loader.ts`** — thin webpack/loader-style wrapper around `transformJsx`. Used by the Next plugin's `swc-loader` chain; the Vite plugin calls `transformJsx` directly.
- **`index.ts`** — public surface: `transformJsx`, `TransformOptions`.

## What it skips

- Files with no `<TagName` match — quick regex prefilter avoids parsing the world.
- `<Fragment>` / `<React.Fragment>` — they don't accept arbitrary props; React logs a warning if you give them any. Bare `<>...</>` parses to `JSXFragment` and never enters the visitor.
- Elements that already carry `data-pa-loc` — idempotent, safe to re-run.
- Files that fail to parse — `errorRecovery: true` is on, but a hard parse error returns `null` rather than crashing the build.

The attribute carries a POSIX-relative `file:line:col` so paths stay portable across OS and CI shapes. The host plugin is responsible for computing `relPath` against the project root.

## Build

```bash
pnpm --filter @pinagent/babel-plugin build
```

Dual ESM + CJS under `dist/` via `tsdown`.

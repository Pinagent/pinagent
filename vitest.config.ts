import { defineConfig } from 'vitest/config';

// Root Vitest config. Picks up every *.test.ts(x) under packages/<pkg>/tests/
// and apps/<app>/tests/ automatically — no per-package configuration needed.
//
// Default environment is Node. Individual tests that need a DOM annotate
// with `// @vitest-environment happy-dom` at the top of the file (the
// widget selector tests do this).
export default defineConfig({
  // Some workspace packages (notably @pinagent/ui) ship .tsx sources with
  // `jsx: "preserve"` in their own tsconfig — Vite's default loader would
  // leave the JSX untransformed when a DOM test imports them. Force the
  // automatic React JSX runtime here so the test pipeline can compile
  // them regardless of the per-package tsconfig. (Vite 8 routes this
  // through oxc, not esbuild.)
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.{ts,tsx}', 'apps/*/tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    isolate: true,
    // better-sqlite3 is a native module — Vite's resolver can't
    // transform it. Externalize so it goes through Node's normal
    // require/import path instead of Vite's. Same for @sqlite.org/*
    // in case any tests pull that in transitively.
    server: {
      deps: {
        external: ['better-sqlite3', /@sqlite\.org\//],
      },
    },
  },
});

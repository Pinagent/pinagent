import { defineConfig } from 'vitest/config';

// Root Vitest config. Picks up every *.test.ts under packages/<pkg>/tests/
// automatically — no per-package configuration needed.
//
// Default environment is Node. Individual tests that need a DOM annotate
// with `// @vitest-environment happy-dom` at the top of the file (the
// widget selector tests do this).
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
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

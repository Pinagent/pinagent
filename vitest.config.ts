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
    include: [
      'packages/*/tests/**/*.test.{ts,tsx}',
      'ee/packages/*/tests/**/*.test.{ts,tsx}',
      'apps/*/tests/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    isolate: true,
    // Many agent-runner tests drive REAL `git` subprocesses (worktree add,
    // merge, push to a bare remote, bulk prune). Run alone they finish in
    // 3–5s, but under full-suite parallelism — dozens of worker threads
    // contending for disk/CPU alongside this machine's 60+ linked worktrees
    // — a single git op can drift past the 5s default and flake the run
    // (agent-merge, bulk-prune, branches-list have all hit this). Bump the
    // global timeouts so load variance doesn't turn green tests red; a
    // genuinely hung test still fails, just later. See the "git ref
    // resolution / capture under load" history in CLAUDE-adjacent notes.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Coverage is opt-in via `pnpm test:coverage` (or `--coverage`). It is
    // reporting-only — no thresholds are enforced yet, so it never fails a
    // build; the goal is visibility into which modules the suite exercises.
    // Scope to actual runtime source under each package's `src/`, and
    // exclude declarative / presentational / stub trees where unit tests
    // add little (see the test-coverage analysis): the @pinagent/ui
    // component wrappers + tokens, the apps/web marketing site, the ee/*
    // placeholder packages, generated code, and the browser-only worker
    // source string.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/__generated__/**',
        '**/fixtures/**',
        '**/*.config.*',
        'packages/ui/**',
        'packages/browser-runtime/src/db-worker-source.ts',
        'ee/packages/**',
        'apps/web/**',
        'apps/cloud/**',
      ],
    },
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

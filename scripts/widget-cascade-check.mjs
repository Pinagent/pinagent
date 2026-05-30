// SPDX-License-Identifier: Apache-2.0
//
// Widget cascade check.
//
// @pinagent/widget is `private: true` and never published. Its IIFE
// is embedded into @pinagent/next-plugin and @pinagent/vite-plugin
// at build time via each consumer's `prebuild` step. So a widget
// IIFE code change that isn't paired with a changeset bumping BOTH
// consumers will ship to nobody — the new widget bytes never reach
// the published tarballs.
//
// This script enforces the rule. Runs in CI on pull_request events
// and locally via `pnpm lint:widget-cascade`. The IIFE entry is
// `packages/widget/src/index.ts` and everything it transitively
// imports; `brand.ts` and `logo.tsx` are SEPARATE library exports
// (consumed at build time by other workspace packages, not embedded)
// so they're excluded from the cascade.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const CHANGESET_DIR = join(REPO_ROOT, '.changeset');

const REQUIRED_CONSUMERS = ['@pinagent/next-plugin', '@pinagent/vite-plugin'];

const NON_IIFE_FILES = new Set(['packages/widget/src/brand.ts', 'packages/widget/src/logo.tsx']);

function isWidgetIifeChange(path) {
  if (!path.startsWith('packages/widget/src/')) return false;
  if (path.startsWith('packages/widget/src/__generated__/')) return false;
  if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return false;
  // Storybook stories + their helpers. Like tests, they live under src/ for
  // convenience but the IIFE entry (`src/index.ts`) never imports them, so
  // they're tree-shaken out and never reach the embedded bytes.
  if (path.startsWith('packages/widget/src/stories/')) return false;
  if (path.endsWith('.stories.ts') || path.endsWith('.stories.tsx')) return false;
  if (NON_IIFE_FILES.has(path)) return false;
  return true;
}

function getBaseRef() {
  // GitHub Actions sets GITHUB_BASE_REF on pull_request events.
  // The Lint step in ci.yml fetches that ref before invoking us so
  // `origin/<base>` is a resolvable ref here.
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }
  // Local fallback. Prefer origin/main if it exists; otherwise main.
  try {
    execSync('git rev-parse --verify origin/main', { stdio: 'ignore' });
    return 'origin/main';
  } catch {
    return 'main';
  }
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

const baseRef = getBaseRef();

let mergeBase;
try {
  mergeBase = git(`merge-base HEAD ${baseRef}`);
} catch {
  console.log(`Could not find merge-base with ${baseRef}. Skipping check.`);
  process.exit(0);
}

// Diff against the merge-base directly (not `...HEAD`) so uncommitted
// changes show up too. In CI the working tree is clean so the result
// is the same; locally, this means a dev can run `pnpm lint:widget-cascade`
// before committing to sanity-check the rule.
const changed = git(`diff --name-only ${mergeBase}`).split('\n').filter(Boolean);
const widgetChanges = changed.filter(isWidgetIifeChange);

if (widgetChanges.length === 0) {
  console.log('No widget IIFE changes detected. Cascade check skipped.');
  process.exit(0);
}

console.log('Widget IIFE changes detected in this diff:');
for (const f of widgetChanges) console.log(`  - ${f}`);

const existingChangesets = new Set(
  git(`ls-tree -r --name-only ${mergeBase} -- .changeset/`)
    .split('\n')
    .filter((p) => p.endsWith('.md') && p !== '.changeset/README.md'),
);

const currentChangesets = existsSync(CHANGESET_DIR)
  ? readdirSync(CHANGESET_DIR)
      .filter((n) => n.endsWith('.md') && n !== 'README.md')
      .map((n) => `.changeset/${n}`)
  : [];

const newChangesets = currentChangesets.filter((p) => !existingChangesets.has(p));

const bumpedPackages = new Set();
for (const p of newChangesets) {
  const content = readFileSync(join(REPO_ROOT, p), 'utf8');
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) continue;
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*['"]?([^'":\s]+)['"]?\s*:/);
    if (m) bumpedPackages.add(m[1]);
  }
}

console.log('\nNew changesets in this diff:');
if (newChangesets.length === 0) {
  console.log('  (none)');
} else {
  for (const p of newChangesets) console.log(`  - ${p}`);
}

const missing = REQUIRED_CONSUMERS.filter((c) => !bumpedPackages.has(c));
if (missing.length > 0) {
  console.error(`\nERROR: widget IIFE changed but no changeset bumps: ${missing.join(', ')}`);
  console.error('');
  console.error('@pinagent/widget is embedded into the consumer packages at build');
  console.error('time. Without a changeset that bumps these consumers, the new');
  console.error('widget bytes will not ship to npm — published next-plugin /');
  console.error('vite-plugin tarballs would still embed the old widget IIFE.');
  console.error('');
  console.error('Fix:');
  console.error('  pnpm changeset');
  console.error('  # select @pinagent/next-plugin and @pinagent/vite-plugin');
  console.error('  # (patch is fine for most widget changes)');
  process.exit(1);
}

console.log(`\nOK: widget IIFE change paired with bumps for ${REQUIRED_CONSUMERS.join(' + ')}.`);

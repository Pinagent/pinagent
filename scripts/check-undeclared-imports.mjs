// SPDX-License-Identifier: Apache-2.0
//
// Undeclared-import linter (the inverse of check-workspace-deps.mjs).
//
// Catches the case where a source file imports from `@pinagent/X` but
// the containing package's `package.json` doesn't declare `@pinagent/X`
// in `dependencies`, `devDependencies`, or `peerDependencies`. This
// "works" inside the monorepo because pnpm symlinks all workspace
// packages into a hoisted node_modules, but it BREAKS for any
// downstream consumer of the published tarball — npm doesn't install
// the dep, so `tsc` and the bundler can't resolve the import.
//
// The class of bug is real: PR #31 caught it when a concurrent PR (#30)
// added an import to apps/cli/src/index.ts but my own PR had stripped
// the corresponding dep. The auto-merge produced a tree where the
// import had no declaration. The existing `check-workspace-deps`
// linter only catches the OPPOSITE direction (declared-but-unimported),
// so it didn't fire — we relied on CI's typecheck to catch it, which
// is wasteful.
//
// Scope:
//   - Packages under packages/, apps/, ee/packages/.
//   - All three dep classes (dependencies + devDependencies +
//     peerDependencies) count as "declared". If a dep appears in any
//     of them, the import is covered.
//   - Self-imports (a package importing from its own name, e.g. for
//     testing that exports are accessible by name) are skipped.
//   - Generated files under __generated__/ are skipped, matching the
//     existing convention in check-spdx.mjs and check-workspace-deps.mjs.
//
// Detection:
//   For each source file, extract `from '@pinagent/*'`, `from "@pinagent/*"`,
//   `require('@pinagent/*')`, `import('@pinagent/*')`. Subpath imports
//   like `@pinagent/foo/bar` are normalized to the bare package name
//   `@pinagent/foo` before the dep lookup.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const WORKSPACE_TREES = ['packages', 'apps', 'ee/packages'];
const SOURCE_SUBDIRS = ['src', 'tests', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '__generated__']);
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const ROOT_CONFIG_PATTERN = /\.config\.(ts|js|mjs|cjs)$/;

// Match: from '@pinagent/foo', from "@pinagent/foo/bar", require('@pinagent/foo'),
// import('@pinagent/foo'). Captures the full module specifier so subpaths
// can be normalized to the bare package name.
const IMPORT_RE = /(?:from|require\(|import\()\s*['"`](@pinagent\/[^'"`]+)['"`]/g;

function listPackageDirs() {
  const dirs = [];
  for (const tree of WORKSPACE_TREES) {
    const base = join(REPO_ROOT, tree);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const path = join(base, name);
      if (!statSync(path).isDirectory()) continue;
      if (existsSync(join(path, 'package.json'))) dirs.push(path);
    }
  }
  return dirs;
}

function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const s = statSync(path);
    if (s.isDirectory()) out.push(...walkFiles(path));
    else if (s.isFile() && SOURCE_EXTENSIONS.test(name)) out.push(path);
  }
  return out;
}

function gatherSourceFiles(pkgDir) {
  const files = [];
  for (const sub of SOURCE_SUBDIRS) {
    files.push(...walkFiles(join(pkgDir, sub)));
  }
  for (const name of readdirSync(pkgDir)) {
    if (ROOT_CONFIG_PATTERN.test(name)) {
      const path = join(pkgDir, name);
      if (statSync(path).isFile()) files.push(path);
    }
  }
  return files;
}

function getDeclaredDeps(pkgJson) {
  // All three dep classes count as "declared" — a peer is enough to
  // satisfy the constraint that downstream consumers must provide it.
  return new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.devDependencies || {}),
    ...Object.keys(pkgJson.peerDependencies || {}),
  ]);
}

function bareName(specifier) {
  // `@pinagent/foo/bar/baz` → `@pinagent/foo`. Scoped packages always
  // have exactly two segments before the subpath.
  const parts = specifier.split('/');
  return `${parts[0]}/${parts[1]}`;
}

function extractPinagentImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const seen = new Set();
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    seen.add(bareName(m[1]));
  }
  return seen;
}

const violations = [];

for (const pkgDir of listPackageDirs()) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const pkgName = pkgJson.name ?? relative(REPO_ROOT, pkgDir);
  const declared = getDeclaredDeps(pkgJson);
  const files = gatherSourceFiles(pkgDir);

  for (const file of files) {
    const imports = extractPinagentImports(file);
    for (const imp of imports) {
      if (imp === pkgName) continue; // self-import
      if (declared.has(imp)) continue;
      violations.push({
        pkg: pkgName,
        pkgJson: relative(REPO_ROOT, pkgJsonPath),
        file: relative(REPO_ROOT, file),
        dep: imp,
      });
    }
  }
}

if (violations.length === 0) {
  console.log('OK — every imported workspace package is declared.');
  process.exit(0);
}

console.error(`Found ${violations.length} undeclared-import violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.pkg} imports ${v.dep} in ${v.file}`);
  console.error(`    but ${v.pkgJson} does not declare it as a dependency.`);
}
console.error('');
console.error("Add the dep to the importing package's `dependencies`, `devDependencies`,");
console.error('or `peerDependencies` as appropriate. The monorepo symlinks all workspace');
console.error('packages into a hoisted node_modules so the import "works" locally, but');
console.error('downstream npm consumers of the published tarball will fail to resolve it.');
process.exit(1);

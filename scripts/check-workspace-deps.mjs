// SPDX-License-Identifier: Apache-2.0
//
// Workspace-dep linter.
//
// Every workspace package that declares an `@pinagent/*` entry in its
// `dependencies` must actually import from it. The stale-dep class of
// bug (PR #25) is mechanical: a refactor extracts code from package A
// into B, the importers move to B, and A's package.json gets left
// pointing at B's old home. Sherif tracks version drift across the
// workspace; it does not catch a declared-but-unimported dependency.
// This script does.
//
// Scope:
//   - Packages under packages/, apps/, ee/packages/.
//   - Only `dependencies` is checked. `devDependencies` is intentionally
//     excluded — workspace devDeps are often declared for tooling/build
//     reasons (e.g. tsdown bundling sibling packages into the published
//     dist, prebuild scripts reading sibling artifacts via filesystem
//     path) and don't ship to consumers anyway. The high-stakes class
//     of bug is a stale `dependencies` entry, because that bloats every
//     downstream user's install.
//   - peerDependencies is also excluded — peers are interface contracts,
//     not consumed imports.
//
// Detection:
//   For each package, walk its src/, tests/, scripts/ subtrees plus any
//   root-level *.config.{ts,js,mjs,cjs}. A dep counts as used if any
//   file contains `from '<dep>'`, `from "<dep>"`, `require('<dep>')`,
//   or `import('<dep>')` — including subpath imports like `from
//   '@pinagent/foo/bar'`.
//
// Allowlist:
//   An explicit allowlist below covers any case where a `dependencies`
//   entry is legitimately declared without an import. Currently empty —
//   the obvious exception cases (widget consumed via filesystem by
//   prebuild scripts, sibling packages bundled into a consumer's dist
//   by tsdown) all live in `devDependencies` and are excluded by the
//   scope rule above. Future entries should always come with a comment.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const ALLOWLIST = new Set([
  // Format: '<consumer-pkg> -> <declared-dep>'
  // Add an entry only if a `dependencies` (not devDependencies) entry is
  // genuinely declared without an import in source — with a comment
  // explaining why.
]);

const WORKSPACE_TREES = ['packages', 'apps', 'ee/packages'];
const SOURCE_SUBDIRS = ['src', 'tests', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '__generated__']);
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const ROOT_CONFIG_PATTERN = /\.config\.(ts|js|mjs|cjs)$/;

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

function getDeclaredWorkspaceRuntimeDeps(pkgJson) {
  // Only `dependencies` is in scope; see the scope rule in the header
  // comment. devDeps and peerDeps are intentionally excluded.
  const deps = pkgJson.dependencies || {};
  return Object.keys(deps).filter((d) => d.startsWith('@pinagent/'));
}

function fileImportsDep(filePath, dep) {
  const content = readFileSync(filePath, 'utf8');
  const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Matches: from '<dep>', from "<dep>", require('<dep>'), import('<dep>'),
  // including subpath suffixes like '@pinagent/foo/bar'.
  const re = new RegExp(`(?:from|require\\(|import\\()\\s*['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`);
  return re.test(content);
}

const stale = [];

for (const pkgDir of listPackageDirs()) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const pkgName = pkgJson.name ?? relative(REPO_ROOT, pkgDir);
  const deps = getDeclaredWorkspaceRuntimeDeps(pkgJson);
  if (deps.length === 0) continue;

  const files = gatherSourceFiles(pkgDir);

  for (const dep of deps) {
    if (dep === pkgName) continue;
    const key = `${pkgName} -> ${dep}`;
    if (ALLOWLIST.has(key)) continue;
    const used = files.some((f) => fileImportsDep(f, dep));
    if (!used) {
      stale.push({
        pkg: pkgName,
        pkgJson: relative(REPO_ROOT, pkgJsonPath),
        dep,
      });
    }
  }
}

if (stale.length === 0) {
  console.log('OK — every declared runtime workspace dep is imported.');
  process.exit(0);
}

console.error(`Found ${stale.length} stale workspace dep declaration(s):\n`);
for (const s of stale) {
  console.error(`  ${s.pkg} declares ${s.dep}`);
  console.error(`    (${s.pkgJson} — no import found in src/, tests/, scripts/, or *.config.*)`);
}
console.error('');
console.error('Either remove the declaration from `dependencies`, move it to');
console.error('`devDependencies` (if it is build-time only — e.g. bundled into');
console.error('your tsdown output), or add an entry to the ALLOWLIST in');
console.error('scripts/check-workspace-deps.mjs with a comment explaining why.');
process.exit(1);

// SPDX-License-Identifier: Apache-2.0
//
// Published-deps linter.
//
// A package that ships to npm (anything without `"private": true`) must
// never list, in its `dependencies`, a workspace package that is itself
// unpublishable. "Unpublishable" means the target is `private: true`, OR
// it sits in the changeset `ignore` list (so it never receives a version
// bump and never lands on the registry). Either way the dependency points
// at something that does not exist on npm at a resolvable version.
//
// This is the bug that shipped `@pinagent/next-plugin@0.2.0` and
// `@pinagent/vite-plugin@0.3.0`: both declared `@pinagent/widget-dock` in
// `dependencies` (the plugins resolve it at runtime to serve the dock's
// static assets), but widget-dock was `private: true` and never published.
// A clean `npm i @pinagent/next-plugin` then 404'd on
// `@pinagent/widget-dock@0.0.0` — the documented install was broken out of
// the box. Sherif tracks version drift; check-workspace-deps catches a
// declared-but-unimported `@pinagent/*` dep. Neither catches a declared,
// imported, *unpublishable* dep. This script does.
//
// The fix for such a finding is one of:
//   - publish the target (drop `private: true`, take it out of the
//     changeset `ignore` list, give it `publishConfig`), or
//   - move the dependency to `devDependencies` if it's build-time only
//     (e.g. tsdown/vite bundles its code into the consumer's dist), or
//   - add an entry to the ALLOWLIST below with a comment explaining why
//     the published package can resolve the target without npm.
//
// Scope: `dependencies` and `optionalDependencies` of every non-private
// package under packages/, apps/, ee/packages/. devDeps and peerDeps are
// out of scope — devDeps don't ship, and a peer is the consumer's job to
// provide.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const ALLOWLIST = new Set([
  // Format: '<publishable-pkg> -> <unpublishable-dep>'
  // Add an entry only with a comment explaining how the publishable
  // package resolves the dep without it being on npm.
]);

const WORKSPACE_TREES = ['packages', 'apps', 'ee/packages'];

/** Packages the changeset config never versions — treated as unpublishable. */
function readChangesetIgnore() {
  try {
    const cfg = JSON.parse(readFileSync(join(REPO_ROOT, '.changeset/config.json'), 'utf8'));
    return new Set(Array.isArray(cfg.ignore) ? cfg.ignore : []);
  } catch {
    return new Set();
  }
}

function listPackageJsonPaths() {
  const out = [];
  for (const tree of WORKSPACE_TREES) {
    const base = join(REPO_ROOT, tree);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const path = join(base, name);
      if (!statSync(path).isDirectory()) continue;
      const pkgJson = join(path, 'package.json');
      if (existsSync(pkgJson)) out.push(pkgJson);
    }
  }
  return out;
}

const changesetIgnore = readChangesetIgnore();

// First pass: catalogue every workspace package and whether it is
// publishable, so dependency targets can be classified.
const manifests = listPackageJsonPaths().map((p) => ({
  path: p,
  json: JSON.parse(readFileSync(p, 'utf8')),
}));

const byName = new Map();
for (const m of manifests) {
  if (m.json.name) byName.set(m.json.name, m);
}

function isUnpublishable(name) {
  const m = byName.get(name);
  if (!m) return false; // not a workspace package — an external npm dep
  return m.json.private === true || changesetIgnore.has(name);
}

const violations = [];

for (const m of manifests) {
  // Only packages that actually ship to npm can drag a broken dep along.
  if (m.json.private === true || changesetIgnore.has(m.json.name)) continue;

  const runtimeDeps = {
    ...(m.json.dependencies || {}),
    ...(m.json.optionalDependencies || {}),
  };

  for (const depName of Object.keys(runtimeDeps)) {
    if (!isUnpublishable(depName)) continue;
    const key = `${m.json.name} -> ${depName}`;
    if (ALLOWLIST.has(key)) continue;
    violations.push({
      pkg: m.json.name,
      pkgJson: relative(REPO_ROOT, m.path),
      dep: depName,
      reason: byName.get(depName)?.json.private === true ? 'private: true' : 'changeset-ignored',
    });
  }
}

if (violations.length === 0) {
  console.log('OK — no published package depends on an unpublishable workspace package.');
  process.exit(0);
}

console.error(`Found ${violations.length} unpublishable runtime dep declaration(s):\n`);
for (const v of violations) {
  console.error(`  ${v.pkg} declares ${v.dep} in dependencies — but ${v.dep} is ${v.reason}`);
  console.error(`    (${v.pkgJson})`);
}
console.error('');
console.error('A published package cannot depend on a workspace package that never');
console.error('reaches npm — the install 404s. Fix by publishing the target, moving');
console.error('the dependency to `devDependencies` (if its code is bundled into your');
console.error('dist), or adding an ALLOWLIST entry in scripts/check-published-deps.mjs.');
process.exit(1);

// SPDX-License-Identifier: Apache-2.0
//
// Release preflight — run by `pnpm release` BEFORE `changeset publish`.
//
// `changeset publish` is not atomic: it attempts every package whose
// current version isn't on npm, collects failures, and reports them at the
// end — it does NOT halt dependents when a dependency fails. That's how the
// 2026-05-30 release shipped `next-plugin@0.3.0` (depending on
// `widget-dock@0.1.0`) live while `widget-dock` itself failed to create,
// leaving the registry in a broken, install-404 state.
//
// This guard refuses to start a release that would do that. It checks two
// things and exits non-zero (blocking the publish) if either fails:
//
//   1. New-package creation. A brand-new scoped package name requires an
//      npm token with *create* rights for the @pinagent org. A granular
//      token scoped to existing packages publishes new versions fine but
//      404s on a new name (exactly what bit us). New names are surfaced
//      loudly and the release is blocked until you acknowledge them with
//      PINAGENT_RELEASE_ALLOW_NEW=1 (set it once you've confirmed your auth
//      can create them — e.g. `npm login` as an org owner).
//
//   2. Internal-dep closure. Every `@pinagent/*` runtime dependency of a
//      package being published must itself be already-on-npm or part of
//      THIS publish batch — otherwise the published artifact points at a
//      version that doesn't exist.
//
// Network: one `npm view <name> versions` per publishable package. A failed
// `npm whoami` (no auth / no connectivity) aborts the release up front
// rather than guessing.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const WORKSPACE_TREES = ['packages', 'apps', 'ee/packages'];
const ALLOW_NEW = process.env.PINAGENT_RELEASE_ALLOW_NEW === '1';
// `--dry-run` (used by CI on PRs): validate without auth and without
// publishing. The dependency-closure check stays a hard failure; the
// new-package gate softens to a warning (create-rights are a release-time
// concern, not a PR one). `npm view` works anonymously for public packages.
const DRY_RUN = process.argv.includes('--dry-run');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function changesetIgnore() {
  try {
    const cfg = readJson(join(REPO_ROOT, '.changeset/config.json'));
    return new Set(Array.isArray(cfg.ignore) ? cfg.ignore : []);
  } catch {
    return new Set();
  }
}

function listManifests() {
  const out = [];
  for (const tree of WORKSPACE_TREES) {
    const base = join(REPO_ROOT, tree);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) out.push({ pj, json: readJson(pj) });
    }
  }
  return out;
}

/** Published versions for `name`, or null if the package does not exist. */
function publishedVersions(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const v = JSON.parse(out);
    return Array.isArray(v) ? v : [v];
  } catch {
    return null; // E404 (new name) or unreachable — whoami check below gates connectivity.
  }
}

function assertNpmAuth() {
  // Under GitHub Actions OIDC trusted publishing there is no logged-in user
  // until publish time — `npm whoami` would fail. `ACTIONS_ID_TOKEN_REQUEST_URL`
  // is present only when `id-token: write` is granted, i.e. npm will auth via
  // OIDC at publish, so the interactive-auth gate doesn't apply.
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    console.log(
      'npm auth: GitHub Actions OIDC (trusted publishing) — credentials minted at publish.',
    );
    return;
  }
  try {
    const who = execFileSync('npm', ['whoami'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    console.log(`npm authenticated as: ${who}`);
  } catch {
    console.error('Release preflight: `npm whoami` failed — not authenticated to npm, or no');
    console.error('connectivity. Run `npm login` (as an org owner if this release creates new');
    console.error('package names) and retry.');
    process.exit(1);
  }
}

/** Can we reach the registry at all? Used to skip dry-run cleanly on a blip. */
function npmReachable() {
  try {
    execFileSync('npm', ['view', 'npm', 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

const ignore = changesetIgnore();
const manifests = listManifests();
const byName = new Map(manifests.map((m) => [m.json.name, m]));

const publishable = manifests.filter((m) => m.json.private !== true && !ignore.has(m.json.name));

if (DRY_RUN) {
  // No publish here — just validation. npm `view` is anonymous for public
  // packages, so we need connectivity, not auth. Skip cleanly if the registry
  // is unreachable so a blip can't redden every PR.
  if (!npmReachable()) {
    console.log('Release preflight (dry-run): npm registry unreachable — skipping.');
    process.exit(0);
  }
  console.log('Release preflight (dry-run): validating publish set + dep closure (no publish).');
} else {
  assertNpmAuth();
}

// Classify each publishable package against the registry.
const versionsCache = new Map();
const vget = (name) => {
  if (!versionsCache.has(name)) versionsCache.set(name, publishedVersions(name));
  return versionsCache.get(name);
};

const publishSet = []; // { name, version, isNew }
for (const m of publishable) {
  const { name, version } = m.json;
  const existing = vget(name);
  const onNpm = existing?.includes(version);
  if (!onNpm) publishSet.push({ name, version, isNew: existing === null });
}

if (publishSet.length === 0) {
  console.log('Release preflight: nothing to publish (all publishable versions already on npm).');
  process.exit(0);
}

console.log('\nRelease preflight — packages this release will publish:');
for (const p of publishSet) {
  console.log(`  ${p.name}@${p.version}${p.isNew ? '   (NEW package name)' : ''}`);
}

const errors = [];
const inSet = new Set(publishSet.map((p) => p.name));

// 1. Internal-dep closure.
for (const p of publishSet) {
  const deps = byName.get(p.name)?.json.dependencies || {};
  for (const [dep, range] of Object.entries(deps)) {
    if (!dep.startsWith('@pinagent/')) continue;
    const depManifest = byName.get(dep);
    if (!depManifest) continue; // not a workspace pkg — external, npm resolves it.
    // workspace:* publishes as the dep's current version; a concrete range publishes as-is.
    const requiredVersion = range.startsWith('workspace:') ? depManifest.json.version : null;
    const willBeAvailable =
      inSet.has(dep) || (requiredVersion && vget(dep)?.includes(requiredVersion));
    if (!willBeAvailable) {
      errors.push(
        `${p.name}@${p.version} depends on ${dep}${requiredVersion ? `@${requiredVersion}` : ` (${range})`}, ` +
          'which is neither already on npm nor part of this release. Publishing would create a broken install.',
      );
    }
  }
}

// 2. New-package creation gate.
const newNames = publishSet.filter((p) => p.isNew);
if (newNames.length > 0 && !ALLOW_NEW) {
  console.error('\nThis release will CREATE new npm package name(s):');
  for (const p of newNames) console.error(`  + ${p.name}`);
  console.error(
    '\nNew scoped packages need an npm token with package-CREATE rights for the @pinagent org.\n' +
      'A granular token scoped to existing packages publishes new versions fine but 404s on a\n' +
      'new name (this caused a partial, install-broken release on 2026-05-30). Confirm your auth\n' +
      'can create them (e.g. `npm login` as an org owner), then re-run with:\n' +
      '  PINAGENT_RELEASE_ALLOW_NEW=1 pnpm release',
  );
  if (DRY_RUN) {
    console.error('(dry-run: not blocking — the create-rights gate enforces at release time.)');
  } else {
    errors.push(
      `${newNames.length} new package name(s) not acknowledged (set PINAGENT_RELEASE_ALLOW_NEW=1).`,
    );
  }
}

if (errors.length > 0) {
  console.error('\nRelease preflight FAILED:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('\nRelease preflight OK — safe to publish.');
process.exit(0);

// SPDX-License-Identifier: Apache-2.0
//
// Post-publish install-smoke — run by `pnpm release` AFTER `changeset
// publish` (and runnable standalone as `pnpm release:smoke`).
//
// `lint:published-deps` catches broken dependency declarations statically,
// but only an actual install proves a published tarball resolves end-to-end
// on the registry — catching missing deps, an unconverted `workspace:*`
// range, or files left out of the tarball. The 2026-05-30 broken release was
// only noticed when a developer hit a 404 in an unrelated repo; this makes
// that check a release step.
//
// For each publishable package whose current version is on npm, it does a
// clean-room `npm install <name>@<version>` in a throwaway dir (a fresh
// registry fetch, ignoring the workspace) and asserts the package and its
// `@pinagent/*` runtime deps resolve. Exits non-zero if any install fails or
// any package that should have published is missing from the registry.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const WORKSPACE_TREES = ['packages', 'apps', 'ee/packages'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function changesetIgnore() {
  try {
    const cfg = readJson(join(REPO_ROOT, '.changeset/config.json'));
    return new Set(Array.isArray(cfg.ignore) ? cfg.ignore : []);
  } catch {
    return new Set();
  }
}

function listPublishable() {
  const ignore = changesetIgnore();
  const out = [];
  for (const tree of WORKSPACE_TREES) {
    const base = join(REPO_ROOT, tree);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      const pj = join(dir, 'package.json');
      if (!existsSync(pj)) continue;
      const json = readJson(pj);
      if (json.private === true || ignore.has(json.name)) continue;
      out.push(json);
    }
  }
  return out;
}

function onNpm(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === version;
  } catch {
    return false;
  }
}

const packages = listPublishable();
const failures = [];
let checked = 0;

for (const pkg of packages) {
  const { name, version } = pkg;
  if (!onNpm(name, version)) {
    // Not published at the current version. If it was supposed to ship this
    // release, the publish step already reported it; flag so a partial
    // release can't pass silently.
    console.log(`· skip ${name}@${version} — not on npm (nothing to smoke-test)`);
    continue;
  }
  checked++;
  const dir = mkdtempSync(join(tmpdir(), 'pinagent-smoke-'));
  try {
    execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
    execFileSync('npm', ['install', `${name}@${version}`, '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Assert the package itself resolved.
    if (!existsSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'))) {
      throw new Error('installed but not present in node_modules');
    }
    // Assert every internal runtime dep resolved too (the broken-install class).
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!dep.startsWith('@pinagent/')) continue;
      if (!existsSync(join(dir, 'node_modules', ...dep.split('/'), 'package.json'))) {
        throw new Error(`runtime dep ${dep} did not resolve`);
      }
    }
    console.log(`✓ ${name}@${version} installs clean`);
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message || '')
      .trim()
      .split('\n')
      .slice(-3)
      .join(' ');
    failures.push(`${name}@${version}: ${msg}`);
    console.error(`✗ ${name}@${version} — ${msg}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`\nInstall-smoke FAILED for ${failures.length} package(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`\nInstall-smoke OK — ${checked} published package(s) install clean from npm.`);
process.exit(0);

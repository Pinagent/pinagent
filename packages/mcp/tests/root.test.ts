// SPDX-License-Identifier: Apache-2.0
/**
 * `resolveRoot` precedence: explicit env var → nearest `.pinagent/`
 * ancestor → nearest `package.json` ancestor → cwd. Exercised against
 * real temp directory trees so the walk-up logic is covered, not mocked.
 */

import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverProjectRoots, resolveProjectRoots, resolveRoot } from '../src/root';

let base: string;

beforeEach(async () => {
  // realpath so macOS's /var -> /private/var symlink doesn't break equality.
  base = realpathSync(await mkdtemp(join(tmpdir(), 'pa-root-')));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('resolveRoot', () => {
  it('honors PINAGENT_PROJECT_ROOT above everything else', () => {
    const explicit = join(base, 'explicit');
    expect(resolveRoot({ PINAGENT_PROJECT_ROOT: explicit }, join(base, 'somewhere', 'else'))).toBe(
      resolve(explicit),
    );
  });

  it('walks up to the nearest .pinagent ancestor', async () => {
    await mkdir(join(base, '.pinagent'), { recursive: true });
    const deep = join(base, 'apps', 'web', 'src');
    await mkdir(deep, { recursive: true });
    expect(resolveRoot({}, deep)).toBe(base);
  });

  it('prefers a closer .pinagent over a higher package.json', async () => {
    // package.json at base, .pinagent in a nested app — the .pinagent
    // pass runs first and should win.
    await writeFile(join(base, 'package.json'), '{}', 'utf8');
    const app = join(base, 'apps', 'web');
    await mkdir(join(app, '.pinagent'), { recursive: true });
    const deep = join(app, 'src', 'components');
    await mkdir(deep, { recursive: true });
    expect(resolveRoot({}, deep)).toBe(app);
  });

  it('falls back to the nearest package.json when no .pinagent exists', async () => {
    await writeFile(join(base, 'package.json'), '{}', 'utf8');
    const deep = join(base, 'src', 'nested');
    await mkdir(deep, { recursive: true });
    expect(resolveRoot({}, deep)).toBe(base);
  });

  it('falls back to cwd when neither marker is present', async () => {
    const deep = join(base, 'plain', 'dir');
    await mkdir(deep, { recursive: true });
    // No .pinagent and no package.json anywhere down this temp subtree;
    // resolveRoot returns the cwd it was given.
    expect(resolveRoot({}, deep)).toBe(resolve(deep));
  });

  it('ignores an empty-string env var (treated as unset)', async () => {
    await mkdir(join(base, '.pinagent'), { recursive: true });
    expect(resolveRoot({ PINAGENT_PROJECT_ROOT: '' }, base)).toBe(base);
  });
});

describe('resolveProjectRoots', () => {
  it('is the legacy single-root resolution when no multi-root var is set', async () => {
    await mkdir(join(base, '.pinagent'), { recursive: true });
    expect(resolveProjectRoots({}, base)).toEqual({
      multi: false,
      roots: [base],
      workspaceRoot: null,
    });
    const explicit = join(base, 'explicit');
    expect(resolveProjectRoots({ PINAGENT_PROJECT_ROOT: explicit }, base)).toEqual({
      multi: false,
      roots: [explicit],
      workspaceRoot: null,
    });
  });

  it('splits PINAGENT_PROJECT_ROOTS on the path delimiter, trimming, resolving and deduping', () => {
    const a = join(base, 'apps', 'a');
    const raw = [` ${a} `, 'apps/b', '', a].join(delimiter);
    expect(resolveProjectRoots({ PINAGENT_PROJECT_ROOTS: raw }, base)).toEqual({
      multi: true,
      roots: [a, join(base, 'apps', 'b')],
      workspaceRoot: null,
    });
  });

  it('folds an inherited PINAGENT_PROJECT_ROOT into the multi-root set', () => {
    const a = join(base, 'a');
    const b = join(base, 'b');
    expect(
      resolveProjectRoots({ PINAGENT_PROJECT_ROOTS: a, PINAGENT_PROJECT_ROOT: b }, base).roots,
    ).toEqual([a, b]);
    expect(
      resolveProjectRoots({ PINAGENT_PROJECT_ROOTS: a, PINAGENT_PROJECT_ROOT: a }, base).roots,
    ).toEqual([a]);
  });

  it('turns on multi-root mode for PINAGENT_WORKSPACE_ROOT alone', () => {
    expect(resolveProjectRoots({ PINAGENT_WORKSPACE_ROOT: '.' }, base)).toEqual({
      multi: true,
      roots: [],
      workspaceRoot: base,
    });
  });

  it('treats empty / whitespace values as unset', async () => {
    await mkdir(join(base, '.pinagent'), { recursive: true });
    expect(
      resolveProjectRoots({ PINAGENT_PROJECT_ROOTS: ' ', PINAGENT_WORKSPACE_ROOT: '' }, base).multi,
    ).toBe(false);
  });
});

describe('discoverProjectRoots', () => {
  const mk = (...parts: string[]) => mkdir(join(base, ...parts, '.pinagent'), { recursive: true });

  it('finds every app with a .pinagent dir, including the workspace root itself', async () => {
    await mk();
    await mk('apps', 'web');
    await mk('apps', 'mobile');
    await mk('packages', 'rn', 'example');
    expect(discoverProjectRoots(base)).toEqual([
      base,
      join(base, 'apps', 'mobile'),
      join(base, 'apps', 'web'),
      join(base, 'packages', 'rn', 'example'),
    ]);
  });

  it('skips node_modules, dot-dirs (worktrees under .claude) and build output', async () => {
    await mk('apps', 'web');
    await mk('node_modules', 'pkg');
    await mk('.claude', 'worktrees', 'wt1', 'apps', 'web');
    await mk('worktrees', 'wt2');
    await mk('apps', 'web', 'dist', 'x');
    expect(discoverProjectRoots(base)).toEqual([join(base, 'apps', 'web')]);
  });

  it('is bounded by depth', async () => {
    await mk('a', 'b', 'c', 'd', 'e');
    expect(discoverProjectRoots(base)).toEqual([]);
    expect(discoverProjectRoots(base, { maxDepth: 5 })).toEqual([
      join(base, 'a', 'b', 'c', 'd', 'e'),
    ]);
  });

  it('returns [] for a missing workspace root instead of throwing', () => {
    expect(discoverProjectRoots(join(base, 'missing'))).toEqual([]);
  });
});

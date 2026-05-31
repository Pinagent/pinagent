// SPDX-License-Identifier: Apache-2.0
/**
 * `listProjectFiles` — the file source behind the composer's `@`-mention
 * picker. Two modes: fuzzy-match over a real throwaway git repo (project
 * mode), and direct directory listing for `/`-/`~`-prefixed queries (path
 * mode). Load-bearing behavior: respect `.gitignore`, rank basename hits
 * above incidental path hits, and browse arbitrary filesystem directories
 * when handed an absolute path.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listProjectFiles } from '../src/files';

describe('listProjectFiles — project mode', () => {
  let repo: string;
  let notARepo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'pa-files-'));
    notARepo = await mkdtemp(join(tmpdir(), 'pa-files-plain-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await mkdir(join(repo, 'src', 'components'), { recursive: true });
    await writeFile(join(repo, 'src', 'components', 'PriceCard.tsx'), 'x');
    await writeFile(join(repo, 'src', 'App.tsx'), 'x');
    await writeFile(join(repo, 'README.md'), '# test\n');
    await writeFile(join(repo, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(repo, 'ignored.txt'), 'secret');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

    // Plain (non-git) project for the fs-walk fallback.
    await mkdir(join(notARepo, 'lib'), { recursive: true });
    await writeFile(join(notARepo, 'lib', 'thing.ts'), 'x');
    await mkdir(join(notARepo, 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(notARepo, 'node_modules', 'dep', 'index.js'), 'x');
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(notARepo, { recursive: true, force: true });
  });

  it('returns project files for an empty query', async () => {
    const res = await listProjectFiles(repo, '');
    expect(res.mode).toBe('project');
    const paths = res.entries.map((e) => e.path);
    expect(paths).toContain('src/App.tsx');
    expect(paths).toContain('src/components/PriceCard.tsx');
  });

  it('respects .gitignore', async () => {
    const res = await listProjectFiles(repo, '');
    expect(res.entries.map((e) => e.path)).not.toContain('ignored.txt');
  });

  it('fuzzy-matches and ranks basename hits first', async () => {
    const res = await listProjectFiles(repo, 'pricecard');
    expect(res.entries[0]?.path).toBe('src/components/PriceCard.tsx');
  });

  it('splits a match into name + dir', async () => {
    const res = await listProjectFiles(repo, 'App');
    const hit = res.entries.find((e) => e.path === 'src/App.tsx');
    expect(hit).toMatchObject({ name: 'App.tsx', dir: 'src', isDir: false });
  });

  it('falls back to an fs walk for a non-git project, skipping node_modules', async () => {
    const res = await listProjectFiles(notARepo, '');
    const paths = res.entries.map((e) => e.path);
    expect(paths).toContain('lib/thing.ts');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });
});

describe('listProjectFiles — path mode', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pa-files-path-'));
    await mkdir(join(dir, 'Photos Library'), { recursive: true });
    await writeFile(join(dir, 'shot.png'), 'x');
    await writeFile(join(dir, 'note.txt'), 'x');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists a directory when the query ends in a slash', async () => {
    const res = await listProjectFiles('/unused', `${dir}/`);
    expect(res.mode).toBe('path');
    const names = res.entries.map((e) => e.name);
    expect(names).toContain('shot.png');
    expect(names).toContain('Photos Library');
  });

  it('puts directories before files', async () => {
    const res = await listProjectFiles('/unused', `${dir}/`);
    expect(res.entries[0]?.isDir).toBe(true);
  });

  it('filters by a partial basename and returns absolute paths', async () => {
    const res = await listProjectFiles('/unused', join(dir, 'sh'));
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ name: 'shot.png', path: join(dir, 'shot.png') });
  });

  it('returns no entries for a non-existent directory', async () => {
    const res = await listProjectFiles('/unused', '/no/such/place/x');
    expect(res.entries).toEqual([]);
  });
});

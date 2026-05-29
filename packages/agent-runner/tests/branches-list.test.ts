// SPDX-License-Identifier: Apache-2.0
/**
 * `listBranches` against real git worktrees: it assembles one row per
 * conversation that has a live worktree (`active` | `landed`), reports
 * clean / uncommitted / behind-base state from git, derives a title from
 * the comment, and stats disk usage. Runs against real git — the
 * cleanliness + ahead/behind detection is exactly the surface git owns.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type BranchesMod = typeof import('../src/branches');
type StorageMod = typeof import('../src/storage');

let branches: BranchesMod;
let storageMod: StorageMod;
let ROOT: string;

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.on('error', rej);
    child.on('exit', (code) => res({ code: code ?? -1, stdout }));
  });
}

async function initRepo(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(root, ['config', 'user.name', 'Pinagent Test']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(root, 'README.md'), 'hello\n', 'utf8');
  await writeFile(join(root, '.gitignore'), '.pinagent/\n', 'utf8');
  await git(root, ['add', 'README.md', '.gitignore']);
  await git(root, ['commit', '-m', 'init']);
}

async function makeWorktree(
  storage: InstanceType<StorageMod['Storage']>,
  comment: string,
  worktreeState: 'active' | 'landed' = 'active',
): Promise<{ id: string; worktreePath: string }> {
  const id = nanoid(10);
  await storage.create(id, {
    comment,
    loc: { file: 'README.md', line: 1, col: 1 },
    selector: 'h1',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
  const worktreeDir = join(ROOT, '.pinagent', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, id);
  const branch = `pinagent/${id}`;
  await git(ROOT, ['worktree', 'add', '-b', branch, worktreePath]);
  await storage.patch(id, { branch, worktreePath, worktreeState });
  return { id, worktreePath };
}

beforeEach(async () => {
  process.env.NODE_ENV = 'production';
  ROOT = join(tmpdir(), `pa-branches-${nanoid(8)}`);
  await initRepo(ROOT);
  branches = await import('../src/branches');
  storageMod = await import('../src/storage');
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('listBranches', () => {
  it('returns [] when no conversation has a worktree', async () => {
    expect(await branches.listBranches(ROOT)).toEqual([]);
  });

  it('reports a clean worktree with a comment-derived title and disk usage', async () => {
    const storage = new storageMod.Storage(ROOT);
    const { id } = await makeWorktree(storage, 'Fix the homepage header spacing');

    const rows = await branches.listBranches(ROOT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      conversationId: id,
      name: `pinagent/${id}`,
      conversationTitle: 'Fix the homepage header spacing',
      state: 'clean',
    });
    // du-derived; never below the 1-MiB floor for a non-empty worktree.
    expect(rows[0]?.diskMb).toBeGreaterThanOrEqual(1);
  });

  it('detects uncommitted edits in the worktree', async () => {
    const storage = new storageMod.Storage(ROOT);
    const { worktreePath } = await makeWorktree(storage, 'edit me');
    await writeFile(join(worktreePath, 'README.md'), 'hello dirty\n', 'utf8');

    const rows = await branches.listBranches(ROOT);
    expect(rows[0]?.state).toBe('uncommitted');
  });

  it('detects a worktree that is behind the base branch', async () => {
    const storage = new storageMod.Storage(ROOT);
    await makeWorktree(storage, 'stale worktree');
    // Advance main after the worktree branched off it. Assert the commit
    // actually landed — a no-op `commit -am` would leave main unmoved and
    // surface as a confusing `clean` instead of a clear failure here.
    await writeFile(join(ROOT, 'README.md'), 'hello v2\n', 'utf8');
    const advance = await git(ROOT, ['commit', '-am', 'advance main']);
    expect(advance.code).toBe(0);

    const rows = await branches.listBranches(ROOT);
    expect(rows[0]?.state).toBe('behind-base');
  });

  it('excludes conversations whose worktree is gone from disk', async () => {
    const storage = new storageMod.Storage(ROOT);
    const { id, worktreePath } = await makeWorktree(storage, 'will vanish');
    // Remove the worktree dir out from under the row (storage still points
    // at it). listBranches must skip rows whose worktreePath doesn't exist.
    await git(ROOT, ['worktree', 'remove', '--force', worktreePath]);
    await rm(worktreePath, { recursive: true, force: true });

    const rows = await branches.listBranches(ROOT);
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });

  it('includes landed worktrees and sorts newest-activity first', async () => {
    const storage = new storageMod.Storage(ROOT);
    const a = await makeWorktree(storage, 'first', 'landed');
    const b = await makeWorktree(storage, 'second', 'active');
    // Bump b's updatedAt so it sorts ahead of a.
    await storage.patch(b.id, { title: 'second renamed' });

    const rows = await branches.listBranches(ROOT);
    expect(rows.map((r) => r.id)).toContain(a.id);
    expect(rows.map((r) => r.id)).toContain(b.id);
    expect(rows[0]?.id).toBe(b.id);
  });
});

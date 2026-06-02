// SPDX-License-Identifier: Apache-2.0
/**
 * Pins `getWorkingCopyStatus` against a real fixture repo (no mocks):
 * file list + stats vs the base merge-base, the on-base-branch guard,
 * dirty detection, and ahead/behind a real remote tracking branch.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type WorkingCopyMod = typeof import('../src/working-copy');
let mod: WorkingCopyMod;

const ROOT = join(tmpdir(), `pa-wc-${nanoid(8)}`);
const REMOTE = join(tmpdir(), `pa-wc-remote-${nanoid(8)}.git`);

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.on('error', rej);
    child.on('close', (code) => res({ code: code ?? -1, stdout }));
  });
}

async function configure(cwd: string): Promise<void> {
  await git(cwd, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(cwd, ['config', 'user.name', 'Pinagent Test']);
  await git(cwd, ['config', 'commit.gpgsign', 'false']);
}

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  await rm(ROOT, { recursive: true, force: true });
  await rm(REMOTE, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
  await git(ROOT, ['init', '-b', 'main']);
  await configure(ROOT);
  await writeFile(join(ROOT, 'README.md'), 'hello\n', 'utf8');
  await writeFile(join(ROOT, 'legacy.txt'), 'old\n', 'utf8');
  await git(ROOT, ['add', '-A']);
  await git(ROOT, ['commit', '-m', 'init']);
  mod = await import('../src/working-copy');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await rm(REMOTE, { recursive: true, force: true });
});

describe('getWorkingCopyStatus', () => {
  it('flags the base branch as default with nothing to PR', async () => {
    const status = await mod.getWorkingCopyStatus(ROOT);
    expect(status.branch).toBe('main');
    expect(status.baseBranch).toBe('main');
    expect(status.isDefaultBranch).toBe(true);
  });

  it('reports per-file stats + statuses for a feature branch (committed + uncommitted)', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/work']);
    // Committed: modify README, add new file, delete legacy.
    await writeFile(join(ROOT, 'README.md'), 'hello\nworld\n', 'utf8');
    await writeFile(join(ROOT, 'feature.ts'), 'export const x = 1;\n', 'utf8');
    await git(ROOT, ['rm', 'legacy.txt']);
    await git(ROOT, ['add', '-A']);
    await git(ROOT, ['commit', '-m', 'feature work']);
    // Uncommitted edit on top — should still count in the diff vs base.
    await writeFile(join(ROOT, 'README.md'), 'hello\nworld\nuncommitted\n', 'utf8');

    const status = await mod.getWorkingCopyStatus(ROOT);
    expect(status.branch).toBe('feat/work');
    expect(status.isDefaultBranch).toBe(false);
    expect(status.dirty).toBe(true);
    expect(status.filesChanged).toBeGreaterThanOrEqual(3);

    const byPath = new Map(status.files.map((f) => [f.path, f]));
    expect(byPath.get('feature.ts')?.status).toBe('added');
    expect(byPath.get('legacy.txt')?.status).toBe('deleted');
    expect(byPath.get('README.md')?.status).toBe('modified');
    expect(byPath.get('README.md')?.added ?? 0).toBeGreaterThan(0);
    expect(status.additions).toBeGreaterThan(0);
  });

  it('works from a subdirectory of the repo (not just the repo root)', async () => {
    // The dev server often runs from a subdir (e.g. an example app) where
    // there's no `.git` entry — status must still reflect the branch diff.
    const sub = join(ROOT, 'examples', 'app');
    await mkdir(sub, { recursive: true });
    const status = await mod.getWorkingCopyStatus(sub);
    expect(status.branch).toBe('feat/work');
    expect(status.filesChanged).toBeGreaterThanOrEqual(3);
  });

  it('tracks ahead/behind once the branch has an upstream', async () => {
    // Stand up a bare remote and push the feature branch to establish
    // an upstream, then add a commit locally → ahead by 1.
    await mkdir(REMOTE, { recursive: true });
    await git(REMOTE, ['init', '--bare', '-b', 'main']);
    await git(ROOT, ['remote', 'add', 'origin', REMOTE]);
    // Commit the pending edit first so the tree is clean for the push.
    await git(ROOT, ['add', '-A']);
    await git(ROOT, ['commit', '-m', 'commit pending']);
    await git(ROOT, ['push', '-u', 'origin', 'feat/work']);

    let status = await mod.getWorkingCopyStatus(ROOT);
    expect(status.hasUpstream).toBe(true);
    expect(status.ahead).toBe(0);

    await writeFile(join(ROOT, 'feature.ts'), 'export const x = 2;\n', 'utf8');
    await git(ROOT, ['add', '-A']);
    await git(ROOT, ['commit', '-m', 'more work']);

    status = await mod.getWorkingCopyStatus(ROOT);
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(0);
  });
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-routing enforcement against real git: `createWorktree` forks from the
 * configured base branch (falling back to HEAD when it doesn't resolve), and
 * `mergeWorktree` refuses to land onto a target the policy disallows. Runs
 * against real git — the fork point and land target are exactly git's surface.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type WorktreeMod = typeof import('../src/worktree');
type StorageMod = typeof import('../src/storage');
type SettingsMod = typeof import('../src/settings-store');

let worktree: WorktreeMod;
let storageMod: StorageMod;
let settingsMod: SettingsMod;
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

async function initRepo(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  await git(ROOT, ['init', '-b', 'main']);
  await git(ROOT, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(ROOT, ['config', 'user.name', 'Pinagent Test']);
  await git(ROOT, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(ROOT, 'README.md'), 'hello\n', 'utf8');
  await writeFile(join(ROOT, '.gitignore'), '.pinagent/\n', 'utf8');
  await git(ROOT, ['add', 'README.md', '.gitignore']);
  await git(ROOT, ['commit', '-m', 'init']);
}

async function makeFeedback(storage: InstanceType<StorageMod['Storage']>): Promise<string> {
  const id = nanoid(10);
  await storage.create(id, {
    comment: 'tweak it',
    loc: { file: 'README.md', line: 1, col: 1 },
    selector: 'h1',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
  return id;
}

function logPathFor(id: string): string {
  return join(ROOT, '.pinagent', 'logs', `${id}.md`);
}

/** Add a committed file on a new branch, leaving HEAD on that branch. */
async function commitFileOnNewBranch(branch: string, file: string): Promise<void> {
  await git(ROOT, ['checkout', '-b', branch]);
  await writeFile(join(ROOT, file), `${file}\n`, 'utf8');
  await git(ROOT, ['add', file]);
  await git(ROOT, ['commit', '-m', `add ${file}`]);
}

beforeEach(async () => {
  process.env.NODE_ENV = 'production';
  ROOT = join(tmpdir(), `pa-routing-${nanoid(8)}`);
  await initRepo();
  await mkdir(join(ROOT, '.pinagent', 'logs'), { recursive: true });
  worktree = await import('../src/worktree');
  storageMod = await import('../src/storage');
  settingsMod = await import('../src/settings-store');
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('createWorktree — base branch', () => {
  it('forks from the configured base branch, not the checked-out HEAD', async () => {
    // HEAD ends up on `dev` (which has dev-only.txt); base stays `main`.
    await commitFileOnNewBranch('dev', 'dev-only.txt');
    const storage = new storageMod.Storage(ROOT);
    await new settingsMod.SettingsStore(ROOT).patch({ baseBranch: 'main' });

    const id = await makeFeedback(storage);
    const path = await worktree.createWorktree(ROOT, id, logPathFor(id));

    // Forked from main → the dev-only file is absent.
    expect(existsSync(join(path, 'dev-only.txt'))).toBe(false);
    expect(existsSync(join(path, 'README.md'))).toBe(true);
  });

  it('falls back to HEAD (and logs) when the base branch does not resolve', async () => {
    await commitFileOnNewBranch('dev', 'dev-only.txt');
    const storage = new storageMod.Storage(ROOT);
    await new settingsMod.SettingsStore(ROOT).patch({ baseBranch: 'no-such-branch' });

    const id = await makeFeedback(storage);
    const path = await worktree.createWorktree(ROOT, id, logPathFor(id));

    // Fell back to HEAD (dev) → the dev-only file is present.
    expect(existsSync(join(path, 'dev-only.txt'))).toBe(true);
    const log = await readFile(logPathFor(id), 'utf8');
    expect(log).toContain('forking worktree from HEAD');
  });
});

describe('mergeWorktree — allowed branches', () => {
  it('refuses to land onto a target the policy disallows', async () => {
    // HEAD is `main`; policy only allows feat/*.
    const storage = new storageMod.Storage(ROOT);
    await new settingsMod.SettingsStore(ROOT).patch({
      baseBranch: 'main',
      allowedBranchPatterns: ['feat/*'],
    });
    const id = await makeFeedback(storage);
    await worktree.createWorktree(ROOT, id, logPathFor(id));

    const result = await worktree.mergeWorktree(ROOT, id, logPathFor(id));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not allow landing onto "main"');
    // Nothing was merged: the worktree branch is still on disk.
    const branches = await git(ROOT, ['branch', '--list', `pinagent/${id}`]);
    expect(branches.stdout).toContain(`pinagent/${id}`);
  });

  it('lands onto a target that matches the policy', async () => {
    // HEAD is `feat/x`, which the policy allows.
    await commitFileOnNewBranch('feat/x', 'feature.txt');
    const storage = new storageMod.Storage(ROOT);
    await new settingsMod.SettingsStore(ROOT).patch({
      baseBranch: 'feat/x',
      allowedBranchPatterns: ['feat/*'],
    });
    const id = await makeFeedback(storage);
    const path = await worktree.createWorktree(ROOT, id, logPathFor(id));
    // Make a real change in the worktree so the land isn't a no-op.
    await writeFile(join(path, 'change.txt'), 'change\n', 'utf8');

    const result = await worktree.mergeWorktree(ROOT, id, logPathFor(id));

    expect(result.ok).toBe(true);
    // The change landed on feat/x.
    expect(existsSync(join(ROOT, 'change.txt'))).toBe(true);
  });
});

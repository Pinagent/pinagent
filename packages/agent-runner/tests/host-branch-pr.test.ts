// SPDX-License-Identifier: Apache-2.0
/**
 * Guards on `openHostBranchPr` / `pushHostBranch` that don't need a
 * remote: the not-a-git-repo bail and the "you're on the base branch"
 * refusal (can't PR a branch onto itself).
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Mod = typeof import('../src/host-branch-pr');
let mod: Mod;

const ROOT = join(tmpdir(), `pa-hbpr-${nanoid(8)}`);
const NOT_REPO = join(tmpdir(), `pa-hbpr-norepo-${nanoid(8)}`);

function git(cwd: string, args: string[]): Promise<number> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'ignore' });
    child.on('error', rej);
    child.on('close', (code) => res(code ?? -1));
  });
}

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
  await mkdir(NOT_REPO, { recursive: true });
  await git(ROOT, ['init', '-b', 'main']);
  await git(ROOT, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(ROOT, ['config', 'user.name', 'Pinagent Test']);
  await git(ROOT, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(ROOT, 'README.md'), 'hi\n', 'utf8');
  await git(ROOT, ['add', '-A']);
  await git(ROOT, ['commit', '-m', 'init']);
  mod = await import('../src/host-branch-pr');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await rm(NOT_REPO, { recursive: true, force: true });
});

describe('openHostBranchPr', () => {
  it('bails when the path is not a git repo', async () => {
    const res = await mod.openHostBranchPr(NOT_REPO, { title: 't', body: 'b' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a git repository/);
  });

  it('refuses to PR the base branch onto itself', async () => {
    const res = await mod.openHostBranchPr(ROOT, { title: 't', body: 'b' });
    expect(res.ok).toBe(false);
    expect(res.branchPushed).toBe(false);
    expect(res.error).toMatch(/base branch/);
  });

  it('gets past the git-repo guard from a subdirectory of the repo', async () => {
    // Regression: the dev server runs from a subdir (e.g. examples/app)
    // where there's no `.git` entry. The old existsSync('.git') guard
    // misfired here, surfacing "project root is not a git repository" when
    // the user clicked Create PR. It must instead resolve the branch and
    // fail later (no remote → push failure), NOT on the repo guard.
    await git(ROOT, ['checkout', '-b', 'feat/x']);
    const sub = join(ROOT, 'examples', 'app');
    await mkdir(sub, { recursive: true });
    const res = await mod.openHostBranchPr(sub, { title: 't', body: 'b' });
    expect(res.error ?? '').not.toMatch(/not a git repository/);
    expect(res.error ?? '').not.toMatch(/base branch/);
    await git(ROOT, ['checkout', 'main']);
  });
});

describe('pushHostBranch', () => {
  it('bails when the path is not a git repo', async () => {
    const res = await mod.pushHostBranch(NOT_REPO);
    expect(res.ok).toBe(false);
    expect(res.pushed).toBe(false);
  });
});

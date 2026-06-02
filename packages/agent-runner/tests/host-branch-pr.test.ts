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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

describe('startHostBranch', () => {
  function gitOut(args: string[]): Promise<string> {
    return new Promise((res, rej) => {
      const child = spawn('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.on('error', rej);
      child.on('close', () => res(out.trim()));
    });
  }

  it('creates a branch carrying uncommitted changes, off the base branch', async () => {
    await git(ROOT, ['checkout', 'main']);
    await writeFile(join(ROOT, 'README.md'), 'edited but not committed\n', 'utf8');

    const res = await mod.startHostBranch(ROOT, { name: 'feat/carry' });
    expect(res.ok).toBe(true);
    expect(res.branch).toBe('feat/carry');
    expect(await gitOut(['symbolic-ref', '--short', 'HEAD'])).toBe('feat/carry');
    // The uncommitted edit travels onto the new branch (git switch -c).
    expect(await gitOut(['status', '--porcelain'])).toContain('README.md');
    await git(ROOT, ['checkout', '--', 'README.md']);
    await git(ROOT, ['checkout', 'main']);
  });

  it('auto-generates a pinagent/<id> name when none is given', async () => {
    await git(ROOT, ['checkout', 'main']);
    const res = await mod.startHostBranch(ROOT);
    expect(res.ok).toBe(true);
    expect(res.branch).toMatch(/^pinagent\//);
    await git(ROOT, ['checkout', 'main']);
  });

  it('rejects an invalid branch name', async () => {
    const res = await mod.startHostBranch(ROOT, { name: 'bad name!!' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid branch name/);
  });

  it('bails when the path is not a git repo', async () => {
    const res = await mod.startHostBranch(NOT_REPO, { name: 'feat/x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a git repository/);
  });
});

describe('commitWorkingChanges + auto-commit on PR/push', () => {
  function gitText(args: string[]): Promise<string> {
    return new Promise((res, rej) => {
      const child = spawn('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.on('error', rej);
      child.on('close', () => res(out.trim()));
    });
  }
  const porcelain = () => gitText(['status', '--porcelain']);

  beforeEach(async () => {
    await git(ROOT, ['checkout', '-f', 'main']);
    await git(ROOT, ['reset', '--hard', 'HEAD']);
  });

  it('commits a dirty tree and no-ops a clean one', async () => {
    await writeFile(join(ROOT, 'README.md'), 'dirty\n', 'utf8');
    const first = await mod.commitWorkingChanges(ROOT, 'test: tweak readme');
    expect(first.ok).toBe(true);
    expect(first.committed).toBe(true);
    expect(await porcelain()).toBe('');

    const second = await mod.commitWorkingChanges(ROOT, 'test: nothing');
    expect(second.ok).toBe(true);
    expect(second.committed).toBe(false);
  });

  it('openHostBranchPr requires a commit message when the tree is dirty', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/dirty-nomsg']);
    await writeFile(join(ROOT, 'README.md'), 'uncommitted\n', 'utf8');
    const res = await mod.openHostBranchPr(ROOT, { title: 't', body: 'b' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/commit message/);
  });

  it('openHostBranchPr commits the dirty tree before pushing', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/dirty-commit']);
    await writeFile(join(ROOT, 'README.md'), 'will be committed\n', 'utf8');
    // No remote → the push fails, but the commit must already have happened.
    const res = await mod.openHostBranchPr(ROOT, {
      title: 'feat: readme',
      body: 'b',
      commitMessage: 'feat: readme',
    });
    expect(await porcelain()).toBe(''); // committed → working tree clean
    expect(res.error ?? '').not.toMatch(/commit message/);
  });

  it('never commits a nested git repo as a gitlink (the .claude/worktrees mess)', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/embedded']);
    // A nested repo with its own commit — exactly what a linked worktree
    // under `.claude/worktrees/<name>` looks like to `git add -A`.
    const nested = join(ROOT, 'nested-wt');
    await mkdir(nested, { recursive: true });
    await git(nested, ['init', '-b', 'main']);
    await git(nested, ['config', 'user.email', 'pinagent-test@example.com']);
    await git(nested, ['config', 'user.name', 'Pinagent Test']);
    await writeFile(join(nested, 'f.txt'), 'inner\n', 'utf8');
    await git(nested, ['add', '-A']);
    await git(nested, ['commit', '-m', 'inner']);
    // A real edit in the host tree alongside the nested repo.
    await writeFile(join(ROOT, 'real.txt'), 'real change\n', 'utf8');

    const res = await mod.commitWorkingChanges(ROOT, 'feat: real change');
    expect(res.ok).toBe(true);
    expect(res.committed).toBe(true);

    // The commit must contain the real file but NO gitlink (mode 160000).
    const tracked = await gitText(['ls-files', '--stage']);
    expect(tracked).toContain('real.txt');
    expect(tracked).not.toMatch(/^160000/m);
    expect(tracked).not.toContain('nested-wt');
  });
});

describe('slugifyBranchName', () => {
  it('drops the conventional-commits prefix and dash-joins the summary', () => {
    expect(mod.slugifyBranchName('feat(dock): add pricing tiers')).toBe(
      'pinagent/add-pricing-tiers',
    );
    expect(mod.slugifyBranchName('fix: handle empty state')).toBe('pinagent/handle-empty-state');
  });

  it('slugifies free-form text + punctuation', () => {
    expect(mod.slugifyBranchName('Update stuff!!!')).toBe('pinagent/update-stuff');
  });

  it('caps length and trims trailing dashes', () => {
    const out = mod.slugifyBranchName('a'.repeat(60));
    expect(out?.startsWith('pinagent/')).toBe(true);
    expect((out ?? '').length).toBeLessThanOrEqual('pinagent/'.length + 40);
    expect(out?.endsWith('-')).toBe(false);
  });

  it('returns undefined when nothing usable remains', () => {
    expect(mod.slugifyBranchName('   ')).toBeUndefined();
    expect(mod.slugifyBranchName('feat(dock): ')).toBeUndefined();
  });
});

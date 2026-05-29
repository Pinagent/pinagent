// SPDX-License-Identifier: Apache-2.0
/**
 * `parseGitBranches` normalization + `listGitBranches` against a real
 * throwaway git repo. The composer's base-branch dropdown is fed from
 * this, so the load-bearing behavior is: strip `origin/`, drop the
 * `HEAD` symref, dedupe local-vs-remote copies, and survive a
 * branch-less / non-git directory by returning `[]`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listGitBranches, parseGitBranches } from '../src/git-branches';

describe('parseGitBranches', () => {
  it('returns sorted, de-duplicated names', () => {
    expect(parseGitBranches('main\ndevelop\nrelease/2.0\n')).toEqual([
      'develop',
      'main',
      'release/2.0',
    ]);
  });

  it('strips the origin/ prefix and dedupes against local copies', () => {
    expect(parseGitBranches('main\ndevelop\norigin/main\norigin/feature-x\n')).toEqual([
      'develop',
      'feature-x',
      'main',
    ]);
  });

  it('drops the origin/HEAD symref and blank lines', () => {
    expect(parseGitBranches('main\norigin/HEAD\norigin/main\n\n  \n')).toEqual(['main']);
  });

  it('returns [] for empty output', () => {
    expect(parseGitBranches('')).toEqual([]);
  });
});

describe('listGitBranches', () => {
  let repo: string;
  let notARepo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'pa-gitbranches-'));
    notARepo = await mkdtemp(join(tmpdir(), 'pa-notarepo-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), '# test\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    execFileSync('git', ['branch', 'develop'], { cwd: repo });
    execFileSync('git', ['branch', 'release/2.0'], { cwd: repo });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(notARepo, { recursive: true, force: true });
  });

  it('lists the local heads of a real repo, sorted', async () => {
    expect(await listGitBranches(repo)).toEqual(['develop', 'main', 'release/2.0']);
  });

  it('returns [] for a directory that is not a git repo', async () => {
    expect(await listGitBranches(notARepo)).toEqual([]);
  });
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side worktree stats / preview / diff / change-count
 * (src/worktree-stats.ts) against a real throwaway git repo. These power
 * the dock's Changes view; the load-bearing behavior is the merge-base
 * comparison (committed + uncommitted changes both count), the
 * null-on-missing-worktree contract, and the diff byte cap with
 * line-boundary truncation.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeWorktreeDiff,
  computeWorktreePreview,
  computeWorktreeStats,
  countWorktreeChanges,
} from '../src/worktree-stats';

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'pa-wtstats-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'file.txt'), 'a\nb\nc\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);

  // Diverge on a feature branch so `main` stays at the base commit: HEAD
  // (feature) carries a committed change, plus an uncommitted untracked
  // file. Stats/diff vs the `main` base ref then show the committed edit;
  // the untracked file drives countWorktreeChanges.
  git(['checkout', '-q', '-b', 'feature']);
  await writeFile(join(repo, 'file.txt'), 'a\nB\nc\nd\n');
  git(['commit', '-q', '-am', 'edit file']);
  await writeFile(join(repo, 'untracked.txt'), 'new file\n');
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('computeWorktreeStats', () => {
  it('returns null for a worktree path that does not exist', async () => {
    expect(await computeWorktreeStats(join(repo, 'nope'), 'main')).toBeNull();
  });

  it('counts committed changes against the base ref', async () => {
    // Compared against `main`, HEAD has the committed "edit file" change:
    // one line modified (1 insertion + 1 deletion) plus one appended line.
    const stats = await computeWorktreeStats(repo, 'main');
    expect(stats).not.toBeNull();
    expect(stats?.filesChanged).toBeGreaterThanOrEqual(1);
    expect(stats?.additions).toBeGreaterThanOrEqual(1);
  });

  it('reports zeroes when HEAD matches the base ref', async () => {
    const stats = await computeWorktreeStats(repo, 'HEAD');
    expect(stats).toEqual({ filesChanged: 0, additions: 0, deletions: 0 });
  });
});

describe('computeWorktreePreview', () => {
  it('returns the first changed content line', async () => {
    const preview = await computeWorktreePreview(repo, 'main');
    // First +/- content line of the diff (a header line is skipped).
    expect(preview.length).toBeGreaterThan(0);
    expect(preview.startsWith('+') || preview.startsWith('-')).toBe(true);
  });

  it('returns empty string for a missing worktree', async () => {
    expect(await computeWorktreePreview(join(repo, 'nope'), 'main')).toBe('');
  });

  it('returns empty string when there is no diff vs the ref', async () => {
    expect(await computeWorktreePreview(repo, 'HEAD')).toBe('');
  });
});

describe('computeWorktreeDiff', () => {
  it('returns the full unified diff, not truncated, for a small change', async () => {
    const result = await computeWorktreeDiff(repo, 'main');
    expect(result).not.toBeNull();
    expect(result?.truncated).toBe(false);
    expect(result?.diff).toContain('file.txt');
  });

  it('returns null for a missing worktree', async () => {
    expect(await computeWorktreeDiff(join(repo, 'nope'), 'main')).toBeNull();
  });
});

describe('countWorktreeChanges', () => {
  it('counts files with uncommitted changes (porcelain line count)', async () => {
    // One untracked file staged-or-not in the working tree.
    expect(await countWorktreeChanges(repo)).toBe(1);
  });

  it('returns null for a missing worktree', async () => {
    expect(await countWorktreeChanges(join(repo, 'nope'))).toBeNull();
  });
});

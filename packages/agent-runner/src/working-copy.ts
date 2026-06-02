// SPDX-License-Identifier: Apache-2.0
/**
 * `getWorkingCopyStatus` — a high-level git summary of the branch the
 * dev-server is running on (the developer's own working copy), diffed
 * against the project's configured base branch.
 *
 * Powers the dock's redesigned dashboard: "what have I changed on this
 * branch, and what's the next action?" Distinct from `changes.ts`, which
 * summarizes pinagent's per-conversation agent worktrees — this is the
 * host checkout itself.
 *
 * All ref comparisons run from `projectRoot` (the host checkout), which
 * is the reliable place to resolve refs — see the "git ref resolution
 * from worktrees" note in branches.ts / changes.ts.
 */
import { computeWorktreeStats } from './agent';
import { isInsideWorkTree, runGitCapture } from './git-utils';
import { listPullRequests } from './pull-requests';
import { SettingsStore } from './settings-store';

export type WorkingCopyFileStatus = 'modified' | 'added' | 'deleted' | 'renamed';

export interface WorkingCopyFile {
  path: string;
  added: number;
  deleted: number;
  status: WorkingCopyFileStatus;
}

export interface WorkingCopyPrRef {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed' | 'draft';
}

export interface WorkingCopyStatus {
  /** Current checkout branch, or 'HEAD' when detached. */
  branch: string;
  /** Configured base branch the PR would target (from project settings). */
  baseBranch: string;
  /** True when the checkout is *on* the base branch — there's nothing to PR. */
  isDefaultBranch: boolean;
  filesChanged: number;
  additions: number;
  deletions: number;
  /** Per-file rows (committed + uncommitted) vs the merge-base with base. */
  files: WorkingCopyFile[];
  /** Commits on HEAD not yet on the remote tracking branch. */
  ahead: number;
  /** Commits on the remote tracking branch not yet local. */
  behind: number;
  /** Whether the branch has a remote tracking branch (`@{upstream}`). */
  hasUpstream: boolean;
  /** Uncommitted changes present in the working tree. */
  dirty: boolean;
  /** The most relevant recorded PR for this branch, if any. */
  pr: WorkingCopyPrRef | null;
}

/** Resolve the current checkout branch. Falls back to 'HEAD' when detached. */
async function resolveCurrentBranch(projectRoot: string): Promise<string> {
  const sym = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  return sym.code === 0 ? sym.stdout.trim() : 'HEAD';
}

/**
 * Map `git diff --name-status` letters to our coarse status enum. We only
 * surface the common four; anything exotic (copy, type-change) reads as
 * 'modified' so the row still renders.
 */
function mapStatusLetter(letter: string): WorkingCopyFileStatus {
  switch (letter[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * Per-file change rows vs `compareTo`. Joins `--numstat` (added/deleted
 * counts) with `--name-status` (status letter) keyed by path. Binary files
 * report '-' counts in numstat → surfaced as 0/0.
 */
async function listFiles(projectRoot: string, compareTo: string): Promise<WorkingCopyFile[]> {
  const numstat = await runGitCapture(projectRoot, ['diff', '--numstat', compareTo]);
  if (numstat.code !== 0) return [];

  const status = await runGitCapture(projectRoot, ['diff', '--name-status', compareTo]);
  const statusByPath = new Map<string, WorkingCopyFileStatus>();
  if (status.code === 0) {
    for (const line of status.stdout.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const letter = parts[0]?.trim() ?? '';
      // Renames are `R<score>\told\tnew` — the new path is the last field.
      const path = parts[parts.length - 1]?.trim() ?? '';
      if (path) statusByPath.set(path, mapStatusLetter(letter));
    }
  }

  const files: WorkingCopyFile[] = [];
  for (const line of numstat.stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addedRaw, deletedRaw] = parts;
    // Renames in numstat are `added\tdeleted\told => new` — take the trailing path.
    const rawPath = parts.slice(2).join('\t').trim();
    const path = rawPath.includes(' => ')
      ? (rawPath.split(' => ').pop()?.replace(/}$/, '').trim() ?? rawPath)
      : rawPath;
    if (!path) continue;
    files.push({
      path,
      added: addedRaw === '-' ? 0 : Number(addedRaw) || 0,
      deleted: deletedRaw === '-' ? 0 : Number(deletedRaw) || 0,
      status: statusByPath.get(path) ?? 'modified',
    });
  }
  return files;
}

/**
 * Ahead/behind the remote tracking branch. Returns `hasUpstream: false`
 * with zero counts when the branch has no `@{upstream}` configured (never
 * pushed) — the caller treats that as "Create PR will push for you."
 */
async function resolveRemoteDivergence(
  projectRoot: string,
): Promise<{ ahead: number; behind: number; hasUpstream: boolean }> {
  const upstream = await runGitCapture(projectRoot, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  if (upstream.code !== 0) return { ahead: 0, behind: 0, hasUpstream: false };

  const aheadRes = await runGitCapture(projectRoot, ['rev-list', '--count', '@{upstream}..HEAD']);
  const behindRes = await runGitCapture(projectRoot, ['rev-list', '--count', 'HEAD..@{upstream}']);
  const toCount = (s: string): number => {
    const n = Number(s.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    ahead: aheadRes.code === 0 ? toCount(aheadRes.stdout) : 0,
    behind: behindRes.code === 0 ? toCount(behindRes.stdout) : 0,
    hasUpstream: true,
  };
}

/** Pick the most relevant recorded PR for `branch`: open/draft win over merged/closed. */
function pickPrForBranch(
  prs: Array<{ number: number; url: string; branch: string; state: WorkingCopyPrRef['state'] }>,
  branch: string,
): WorkingCopyPrRef | null {
  const mine = prs.filter((p) => p.branch === branch);
  if (mine.length === 0) return null;
  const live = mine.find((p) => p.state === 'open' || p.state === 'draft');
  const chosen = live ?? mine[0];
  if (!chosen) return null;
  return { number: chosen.number, url: chosen.url, state: chosen.state };
}

export async function getWorkingCopyStatus(projectRoot: string): Promise<WorkingCopyStatus> {
  const { baseBranch } = await new SettingsStore(projectRoot).read();
  const branch = await resolveCurrentBranch(projectRoot);
  const isDefaultBranch = branch === baseBranch;

  // Diff against the merge-base with the base branch so only this branch's
  // own work shows (not base commits made since it forked). Mirrors
  // worktree-stats.ts's resolution. Falls back to the base ref itself when
  // merge-base can't be computed (base not present locally).
  const mb = await runGitCapture(projectRoot, ['merge-base', baseBranch, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseBranch;

  // Detect the repo via `git rev-parse`, not `existsSync('.git')` — see
  // isInsideWorkTree for why (subdirectories + linked worktrees).
  const notGitRepo = !(await isInsideWorkTree(projectRoot));

  const [stats, files, divergence, dirtyStatus, prs] = await Promise.all([
    notGitRepo ? Promise.resolve(null) : computeWorktreeStats(projectRoot, baseBranch),
    notGitRepo ? Promise.resolve([]) : listFiles(projectRoot, compareTo),
    notGitRepo
      ? Promise.resolve({ ahead: 0, behind: 0, hasUpstream: false })
      : resolveRemoteDivergence(projectRoot),
    notGitRepo
      ? Promise.resolve({ code: -1, stdout: '', stderr: '' })
      : runGitCapture(projectRoot, ['status', '--porcelain']),
    listPullRequests(projectRoot).catch(() => []),
  ]);

  return {
    branch,
    baseBranch,
    isDefaultBranch,
    filesChanged: stats?.filesChanged ?? files.length,
    additions: stats?.additions ?? 0,
    deletions: stats?.deletions ?? 0,
    files,
    ahead: divergence.ahead,
    behind: divergence.behind,
    hasUpstream: divergence.hasUpstream,
    dirty: dirtyStatus.code === 0 && dirtyStatus.stdout.trim().length > 0,
    pr: pickPrForBranch(prs, branch),
  };
}

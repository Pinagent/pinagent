// SPDX-License-Identifier: Apache-2.0
/**
 * Server-side PR composer. Takes a set of conversation IDs whose
 * worktrees the user wants bundled into one GitHub PR; replays their
 * commits onto a fresh branch in a throwaway worktree (so the user's
 * main checkout is never disturbed); pushes that branch; and opens
 * the PR via GitHub's REST API.
 *
 * Auth: reads `GITHUB_TOKEN` from the env. If the host project uses
 * `gh auth setup-git` or a PAT, the same token works. The dock surfaces
 * a clear error when the var is missing instead of failing silently.
 *
 * Conflict handling: V1 aborts on the first cherry-pick conflict and
 * surfaces the conflict files in the error. Multi-conversation merges
 * that touch the same hunks are rare-but-real; auto-resolution belongs
 * in a follow-up if/when the workflow shows it's common.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { runGitCapture } from './git-utils';
import { Storage } from './storage';

const DEFAULT_BASE_BRANCH = 'main';

export interface CreatePrInput {
  /**
   * Conversation IDs to bundle into the PR. Order is preserved — first
   * conversation's commits land first, etc. Must be non-empty.
   */
  conversationIds: string[];
  /** PR title. */
  title: string;
  /** PR body / description (markdown). */
  body: string;
  /**
   * Branch name to push. Defaults to `pinagent/pr-<random>` so multiple
   * pending PRs don't collide.
   */
  branchName?: string;
  /**
   * Base branch on GitHub. Defaults to `main`. The PR is opened with
   * `head=<branchName>` and `base=<baseBranch>`.
   */
  baseBranch?: string;
}

export interface CreatePrResult {
  number: number;
  url: string;
  branch: string;
}

export class CreatePrError extends Error {
  constructor(
    message: string,
    /** Stable code for the dock to surface a useful error UI. */
    public readonly code:
      | 'no-token'
      | 'no-remote'
      | 'unknown-remote'
      | 'no-conversations'
      | 'conversation-missing'
      | 'no-commits'
      | 'cherry-pick-conflict'
      | 'push-failed'
      | 'github-api-failed',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CreatePrError';
  }
}

export async function createPr(projectRoot: string, input: CreatePrInput): Promise<CreatePrResult> {
  if (input.conversationIds.length === 0) {
    throw new CreatePrError('no conversations selected', 'no-conversations');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new CreatePrError(
      'GITHUB_TOKEN env var required to create a PR. Set it on your dev-server process.',
      'no-token',
    );
  }

  const { owner, repo } = await resolveGithubRemote(projectRoot);
  const baseBranch = input.baseBranch ?? DEFAULT_BASE_BRANCH;
  const branchName = input.branchName ?? `pinagent/pr-${nanoid(8)}`;

  // Resolve every conversation's worktree branch up-front so we fail
  // fast on a missing/discarded conversation before we touch git state.
  const storage = new Storage(projectRoot);
  const branches: string[] = [];
  for (const id of input.conversationIds) {
    const rec = await storage.read(id);
    if (!rec) {
      throw new CreatePrError(`conversation ${id} not found`, 'conversation-missing', { id });
    }
    if (!rec.branch) {
      throw new CreatePrError(
        `conversation ${id} has no worktree branch (inline-mode runs can't be PR'd)`,
        'conversation-missing',
        { id },
      );
    }
    branches.push(rec.branch);
  }

  const tempWorktree = join(projectRoot, '.pinagent', 'pr-worktrees', `bundle-${nanoid(8)}`);
  await mkdir(join(projectRoot, '.pinagent', 'pr-worktrees'), { recursive: true });

  try {
    // 1. Create a throwaway worktree on a fresh branch off baseBranch.
    const add = await runGitCapture(projectRoot, [
      'worktree',
      'add',
      '-b',
      branchName,
      tempWorktree,
      baseBranch,
    ]);
    if (add.code !== 0) {
      throw new CreatePrError(`git worktree add failed: ${add.stderr.trim()}`, 'push-failed', {
        stderr: add.stderr.trim(),
      });
    }

    // 2. Cherry-pick each conversation's commits in order. `git rev-list
    //    --reverse` gives commits oldest-first, matching the order we
    //    want to apply them.
    let totalCommits = 0;
    for (const branch of branches) {
      const list = await runGitCapture(tempWorktree, [
        'rev-list',
        '--reverse',
        `${baseBranch}..${branch}`,
      ]);
      if (list.code !== 0) {
        throw new CreatePrError(
          `git rev-list failed for branch ${branch}: ${list.stderr.trim()}`,
          'no-commits',
          { branch, stderr: list.stderr.trim() },
        );
      }
      const commits = list.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (commits.length === 0) continue;
      totalCommits += commits.length;
      const pick = await runGitCapture(tempWorktree, ['cherry-pick', ...commits]);
      if (pick.code !== 0) {
        // Abort so the worktree is in a clean state for the finally-block cleanup.
        await runGitCapture(tempWorktree, ['cherry-pick', '--abort']).catch(() => {});
        const conflicts = await listConflictedFiles(tempWorktree);
        throw new CreatePrError(
          `cherry-pick conflict in branch ${branch}`,
          'cherry-pick-conflict',
          { branch, conflicts, stderr: pick.stderr.trim() },
        );
      }
    }

    if (totalCommits === 0) {
      throw new CreatePrError('selected conversations have no commits ahead of base', 'no-commits');
    }

    // 3. Push the branch.
    const push = await runGitCapture(tempWorktree, ['push', '-u', 'origin', branchName]);
    if (push.code !== 0) {
      throw new CreatePrError(`git push failed: ${push.stderr.trim()}`, 'push-failed', {
        stderr: push.stderr.trim(),
      });
    }

    // 4. Open the PR via GitHub REST.
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'pinagent',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: branchName,
        base: baseBranch,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new CreatePrError(
        `GitHub API ${response.status} ${response.statusText}`,
        'github-api-failed',
        { status: response.status, body: text },
      );
    }
    const pr = (await response.json()) as { number: number; html_url: string };
    return { number: pr.number, url: pr.html_url, branch: branchName };
  } finally {
    // Always clean up the throwaway worktree so .pinagent/pr-worktrees/
    // doesn't accumulate stale entries.
    await runGitCapture(projectRoot, ['worktree', 'remove', '--force', tempWorktree]).catch(
      () => {},
    );
    await runGitCapture(projectRoot, ['worktree', 'prune']).catch(() => {});
  }
}

async function listConflictedFiles(cwd: string): Promise<string[]> {
  const r = await runGitCapture(cwd, ['diff', '--name-only', '--diff-filter=U']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse the project's `origin` remote into `{owner, repo}`. Handles
 * both SSH (`git@github.com:owner/repo.git`) and HTTPS
 * (`https://github.com/owner/repo.git`) remote URLs.
 */
async function resolveGithubRemote(projectRoot: string): Promise<{ owner: string; repo: string }> {
  const r = await runGitCapture(projectRoot, ['remote', 'get-url', 'origin']);
  if (r.code !== 0) {
    throw new CreatePrError(
      'no `origin` remote configured; add one before creating a PR',
      'no-remote',
      { stderr: r.stderr.trim() },
    );
  }
  const url = r.stdout.trim();
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  const https = /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (https) return { owner: https[1]!, repo: https[2]! };
  throw new CreatePrError(`origin remote is not a GitHub URL: ${url}`, 'unknown-remote', { url });
}

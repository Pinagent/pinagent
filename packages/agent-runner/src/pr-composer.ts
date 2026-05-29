// SPDX-License-Identifier: Apache-2.0
/**
 * `composePullRequest` — orchestrate the multi-conversation PR flow.
 *
 * Takes a set of conversation ids the user multi-selected in the dock's
 * Changes view, bundles their commits onto a fresh compose branch,
 * pushes it, and (if a GitHub token is available) opens the PR.
 *
 * Done in an isolated temporary worktree so the developer's main
 * checkout stays untouched — the user can keep editing on their
 * working branch while the compose runs.
 *
 * On any failure during merge or push, the temp worktree + compose
 * branch are removed so the project doesn't accumulate half-built state.
 * Individual conversation worktrees are only cleaned up + marked landed
 * after the push succeeds — the PR being merged is the user's
 * responsibility, but at this point their changes are safely on the
 * remote.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';
import { recordAuditEvent } from './audit-log';
import { resolveOriginRemote } from './git-remote';
import { runGitCapture } from './git-utils';
import { resolveGithubToken } from './github-auth';
import { recordPullRequest } from './pull-requests';
import { Storage } from './storage';

export const ComposeOptsSchema = z.object({
  feedbackIds: z.array(z.string().min(1)).min(1).max(50),
  branchName: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, 'invalid branch name'),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000),
  baseBranch: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, 'invalid base branch'),
});

export interface ComposeOpts {
  /** Conversation ids to include in this PR, in the order they should be merged. */
  feedbackIds: string[];
  /** Branch name on the compose side (e.g. `pinagent/batch-3a8e`). */
  branchName: string;
  /** PR title. */
  title: string;
  /** PR body (markdown). */
  description: string;
  /** Base branch to branch off and target the PR at. */
  baseBranch: string;
}

export interface ComposeResult {
  ok: boolean;
  /** Final PR URL if Octokit opened one. */
  prUrl?: string;
  /** True if `git push` succeeded — set even when the PR API call wasn't made. */
  branchPushed: boolean;
  /**
   * Set when the branch was pushed but no PR was opened. Surfaces a
   * "compare" URL the user can click to open the PR manually on GitHub.
   * Empty when the remote isn't GitHub.
   */
  manualCompareUrl?: string;
  /** Human-readable failure reason. Set when `ok` is false. */
  error?: string;
  /** Files in conflict when the failure was a merge conflict. */
  conflicts?: { feedbackId: string; files: string[] };
}

const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,127}$/;

export async function composePullRequest(
  projectRoot: string,
  opts: ComposeOpts,
): Promise<ComposeResult> {
  if (opts.feedbackIds.length === 0) {
    return { ok: false, branchPushed: false, error: 'no conversations selected' };
  }
  if (!BRANCH_NAME_RE.test(opts.branchName)) {
    return {
      ok: false,
      branchPushed: false,
      error: 'invalid branch name (alphanumeric + ./_- only)',
    };
  }
  if (!existsSync(join(projectRoot, '.git'))) {
    return { ok: false, branchPushed: false, error: 'project root is not a git repository' };
  }

  const storage = new Storage(projectRoot);

  // Verify every selected conv has an active worktree before touching
  // git state. Errors here mean the user selected stale rows; better to
  // bail than create a half-empty compose branch.
  const recs = [];
  for (const id of opts.feedbackIds) {
    const rec = await storage.read(id);
    if (!rec) return { ok: false, branchPushed: false, error: `conversation not found: ${id}` };
    if (rec.worktreeState !== 'active') {
      return {
        ok: false,
        branchPushed: false,
        error: `conversation ${id} is ${rec.worktreeState}; only active conversations can be composed`,
      };
    }
    if (!rec.worktreePath || !rec.branch) {
      return {
        ok: false,
        branchPushed: false,
        error: `conversation ${id} has no worktree (inline-mode submission)`,
      };
    }
    if (!existsSync(rec.worktreePath)) {
      return {
        ok: false,
        branchPushed: false,
        error: `conversation ${id} worktree no longer exists at ${rec.worktreePath}`,
      };
    }
    recs.push(rec);
  }

  // Per-worktree: commit any uncommitted edits onto the conv's branch.
  // Mirrors `mergeWorktree`'s logic — the agent leaves work uncommitted
  // by design; landing (whether single or batched) is "accept these".
  for (const rec of recs) {
    const wt = rec.worktreePath!;
    const status = await runGitCapture(wt, ['status', '--porcelain']);
    if (status.code !== 0) {
      return {
        ok: false,
        branchPushed: false,
        error: `git status failed in ${rec.id} worktree: ${status.stderr.trim()}`,
      };
    }
    if (!status.stdout.trim()) continue;
    const add = await runGitCapture(wt, ['add', '-A']);
    if (add.code !== 0) {
      return {
        ok: false,
        branchPushed: false,
        error: `git add failed in ${rec.id}: ${add.stderr.trim()}`,
      };
    }
    const subject = (rec.comment.split(/\r?\n/)[0] ?? '').trim();
    const subjectShort = subject.length > 70 ? `${subject.slice(0, 67)}…` : subject || 'agent edit';
    const msg = [`pinagent: ${subjectShort}`, '', `Feedback: ${rec.id}`, ''].join('\n');
    const commit = await runGitCapture(wt, ['commit', '-m', msg]);
    if (commit.code !== 0 && !/nothing to commit/.test(`${commit.stdout}\n${commit.stderr}`)) {
      return {
        ok: false,
        branchPushed: false,
        error: `git commit failed in ${rec.id}: ${commit.stderr.trim() || commit.stdout.trim()}`,
      };
    }
  }

  // The compose work happens in a throwaway worktree so we don't touch
  // the user's main checkout. Naming uses the branch (sanitized to a
  // filesystem-safe form) so two concurrent composes pick different dirs.
  const safeName = opts.branchName.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const composeDir = join(projectRoot, '.pinagent', 'compose');
  await mkdir(composeDir, { recursive: true });
  const composePath = join(composeDir, safeName);

  // If something previous left a stale dir or branch behind, clean up
  // before creating fresh. Best-effort — don't fail the compose if these
  // throw (git will reject the worktree-add if there's a real conflict).
  await rm(composePath, { recursive: true, force: true }).catch(() => {});
  await runGitCapture(projectRoot, ['worktree', 'prune']);
  await runGitCapture(projectRoot, ['branch', '-D', opts.branchName]).catch(() => {});

  // Create the compose worktree on the compose branch starting from base.
  const wtAdd = await runGitCapture(projectRoot, [
    'worktree',
    'add',
    '-b',
    opts.branchName,
    composePath,
    opts.baseBranch,
  ]);
  if (wtAdd.code !== 0) {
    return {
      ok: false,
      branchPushed: false,
      error: `worktree add failed (base=${opts.baseBranch}): ${wtAdd.stderr.trim()}`,
    };
  }

  const cleanupCompose = async (): Promise<void> => {
    await runGitCapture(projectRoot, ['worktree', 'remove', '--force', composePath]);
    await runGitCapture(projectRoot, ['worktree', 'prune']);
    await runGitCapture(projectRoot, ['branch', '-D', opts.branchName]);
  };

  // Merge each conv's branch onto the compose branch in selected order.
  // A merge conflict mid-batch aborts the merge, tears down the compose,
  // and surfaces which files conflicted so the user can re-order or
  // resolve before retrying.
  for (const rec of recs) {
    const merge = await runGitCapture(composePath, ['merge', '--no-ff', '--no-edit', rec.branch!]);
    if (merge.code !== 0) {
      const conflicted = await runGitCapture(composePath, [
        'diff',
        '--name-only',
        '--diff-filter=U',
      ]);
      const files = conflicted.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await runGitCapture(composePath, ['merge', '--abort']);
      await cleanupCompose();
      return {
        ok: false,
        branchPushed: false,
        error: `merge conflict integrating ${rec.id} (${rec.branch})`,
        conflicts: { feedbackId: rec.id, files },
      };
    }
  }

  // Push the compose branch. `git push` uses the user's local git
  // credentials (SSH keys, credential manager, etc.) — pinagent doesn't
  // need to manage them. If the push fails (no remote, auth issues), we
  // tear down the compose so the next attempt starts clean.
  const push = await runGitCapture(projectRoot, [
    'push',
    '-u',
    'origin',
    `${opts.branchName}:${opts.branchName}`,
  ]);
  if (push.code !== 0) {
    await cleanupCompose();
    return {
      ok: false,
      branchPushed: false,
      error: `git push failed: ${push.stderr.trim() || push.stdout.trim()}`,
    };
  }

  // Push succeeded — the user's work is safely on the remote. Mark each
  // included conv as landed + tear down its local worktree. From here
  // forward we no longer roll back on errors; the PR API call is
  // best-effort and the user can always open it manually.
  for (const rec of recs) {
    if (rec.worktreePath && rec.branch) {
      await runGitCapture(projectRoot, ['worktree', 'remove', '--force', rec.worktreePath]);
      await runGitCapture(projectRoot, ['worktree', 'prune']);
      await runGitCapture(projectRoot, ['branch', '-D', rec.branch]);
    }
    await storage.patch(rec.id, { worktreeState: 'landed' }).catch(() => {});
    await recordAuditEvent(projectRoot, {
      conversationId: rec.id,
      actor: 'user',
      action: 'conversation_landed',
      payload: {
        via: 'pr',
        branch: rec.branch ?? opts.branchName,
        composeBranch: opts.branchName,
      },
    });
  }

  // The compose worktree on disk can go; the branch itself is on the
  // remote (and still locally until next prune) — keep the local copy
  // so the user can `git checkout <branch>` to inspect.
  await rm(composePath, { recursive: true, force: true }).catch(() => {});
  await runGitCapture(projectRoot, ['worktree', 'prune']);

  // Open the PR if Octokit is configured + the remote is GitHub.
  // Token precedence: dock-stored secret (set via Connections route) →
  // GITHUB_TOKEN env → PINAGENT_GITHUB_TOKEN env. The Connections path
  // is the new Phase 5 route; env vars stay for CI / scripting.
  const token = await resolveGithubToken(projectRoot);
  const remote = await resolveOriginRemote(projectRoot);
  const manualCompareUrl = remote
    ? `https://github.com/${remote.owner}/${remote.repo}/compare/${encodeURIComponent(
        opts.baseBranch,
      )}...${encodeURIComponent(opts.branchName)}?expand=1`
    : undefined;

  if (!token || !remote) {
    return {
      ok: true,
      branchPushed: true,
      ...(manualCompareUrl ? { manualCompareUrl } : {}),
    };
  }

  try {
    const octokit = new Octokit({ auth: token });
    const created = await octokit.pulls.create({
      owner: remote.owner,
      repo: remote.repo,
      title: opts.title,
      body: opts.description,
      head: opts.branchName,
      base: opts.baseBranch,
    });
    // Best-effort: record the PR for the dock's PRs view. A failure
    // here shouldn't mask the fact that the PR was opened — the user
    // already has the URL.
    await recordPullRequest(projectRoot, {
      number: created.data.number,
      url: created.data.html_url,
      branch: opts.branchName,
      baseBranch: opts.baseBranch,
      title: opts.title,
      body: opts.description,
      conversationIds: opts.feedbackIds,
    }).catch(() => {});
    await recordAuditEvent(projectRoot, {
      conversationId: null,
      actor: 'user',
      action: 'pr_created',
      payload: {
        number: created.data.number,
        url: created.data.html_url,
        branch: opts.branchName,
        baseBranch: opts.baseBranch,
        title: opts.title,
        conversationIds: opts.feedbackIds,
      },
    });
    return { ok: true, branchPushed: true, prUrl: created.data.html_url };
  } catch (e) {
    // Push succeeded; the PR API call failed (token scope, network,
    // etc.). Fall back to the manual-create path with a clear hint.
    return {
      ok: true,
      branchPushed: true,
      ...(manualCompareUrl ? { manualCompareUrl } : {}),
      error: `pushed ok, but GitHub PR API call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The shared "push a branch + open a PR on GitHub" core.
 *
 * Lifted out of `pr-composer.ts` so two callers can share one
 * implementation of the push → Octokit-create → record → audit dance:
 *   - `composePullRequest` (multi-conversation worktree merge), and
 *   - `openHostBranchPr` (the dock dashboard's branch-centric "Create PR").
 *
 * Deliberately depends on `git` + `@octokit/rest` only — NOT the Claude
 * Agent SDK. That keeps it cheap enough for the `@pinagent/mcp` binary to
 * import without dragging the SDK into its bundle (the PR-description
 * summarization lives in the SDK-heavy `summarize-changes.ts`, used only
 * server-side by the dock endpoint).
 */
import { Octokit } from '@octokit/rest';
import { recordAuditEvent } from './audit-log';
import { resolveOriginRemote } from './git-remote';
import { runGitCapture } from './git-utils';
import { resolveGithubToken } from './github-auth';
import { recordPullRequest } from './pull-requests';

/**
 * Outcome of a push + open-PR attempt. Mirrors the relevant subset of
 * `ComposeResult` so callers can spread it into their own result shape.
 */
export interface GitHubPrResult {
  ok: boolean;
  /** Final PR URL if Octokit opened one. */
  prUrl?: string;
  /** True if `git push` succeeded — set even when the PR API call wasn't made. */
  branchPushed: boolean;
  /**
   * Set when the branch was pushed but no PR was opened (no token, or the
   * API call failed). A GitHub "compare" URL the user can click to open the
   * PR by hand. Absent when the remote isn't GitHub.
   */
  manualCompareUrl?: string;
  /** Human-readable failure reason. Set when `ok` is false. */
  error?: string;
}

/**
 * Push `branchName` to `origin`, setting upstream. Uses the user's local
 * git credentials (SSH keys, credential manager) — pinagent never manages
 * them. Returns `{ ok }` plus the captured error on failure; never throws.
 */
export async function pushBranch(
  projectRoot: string,
  branchName: string,
): Promise<{ ok: boolean; error?: string }> {
  const push = await runGitCapture(projectRoot, [
    'push',
    '-u',
    'origin',
    `${branchName}:${branchName}`,
  ]);
  if (push.code !== 0) {
    return { ok: false, error: `git push failed: ${push.stderr.trim() || push.stdout.trim()}` };
  }
  return { ok: true };
}

export interface OpenPrOpts {
  /** Head branch — must already be pushed to origin. */
  branchName: string;
  /** Base branch to target the PR at. */
  baseBranch: string;
  title: string;
  /** PR body (markdown). */
  body: string;
  /** Conversation ids to associate with the PR record (empty for branch-centric PRs). */
  conversationIds: string[];
}

/**
 * Open a PR on GitHub for an already-pushed branch, record it for the
 * dock's PRs view, and write a `pr_created` audit event. When no token /
 * non-GitHub remote is configured, returns the manual-compare fallback
 * with `branchPushed: true` so the caller can point the user at GitHub.
 *
 * Assumes `branchName` is already on the remote — call `pushBranch` first.
 */
export async function openPrOnGitHub(
  projectRoot: string,
  opts: OpenPrOpts,
): Promise<GitHubPrResult> {
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
      body: opts.body,
      head: opts.branchName,
      base: opts.baseBranch,
    });
    // Best-effort: record the PR for the dock's PRs view. A failure here
    // shouldn't mask the fact that the PR was opened — the user already
    // has the URL.
    await recordPullRequest(projectRoot, {
      number: created.data.number,
      url: created.data.html_url,
      branch: opts.branchName,
      baseBranch: opts.baseBranch,
      title: opts.title,
      body: opts.body,
      conversationIds: opts.conversationIds,
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
        conversationIds: opts.conversationIds,
      },
    });
    return { ok: true, branchPushed: true, prUrl: created.data.html_url };
  } catch (e) {
    // Push succeeded; the PR API call failed (token scope, network, etc.).
    // Fall back to the manual-create path with a clear hint.
    return {
      ok: true,
      branchPushed: true,
      ...(manualCompareUrl ? { manualCompareUrl } : {}),
      error: `pushed ok, but GitHub PR API call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

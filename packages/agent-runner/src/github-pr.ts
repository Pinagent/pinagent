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
import { runCapture, runGitCapture } from './git-utils';
import { resolveGithubToken } from './github-auth';
import { recordPullRequest, updatePullRequestBody } from './pull-requests';

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

  if (!remote) {
    // Non-GitHub remote (or none) — nothing to open against.
    return { ok: true, branchPushed: true };
  }

  let apiError: string | undefined;

  // 1) Octokit, when a token is configured (dock secret / GITHUB_TOKEN).
  if (token) {
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
      await recordOpenedPr(projectRoot, opts, created.data.number, created.data.html_url);
      return { ok: true, branchPushed: true, prUrl: created.data.html_url };
    } catch (e) {
      // Token present but the API call failed (scope, network) — fall through
      // to the gh CLI, which may be authed even when the token isn't scoped.
      apiError = `GitHub API call failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 2) gh CLI fallback — uses the developer's existing `gh auth` (no stored
  //    token needed), the way Claude Code opens PRs. Skipped silently if gh
  //    isn't installed / authed.
  const gh = await createPrViaGh(projectRoot, opts);
  if (gh.url) {
    const number = parsePrNumberFromUrl(gh.url);
    if (number !== null) await recordOpenedPr(projectRoot, opts, number, gh.url);
    return { ok: true, branchPushed: true, prUrl: gh.url };
  }

  // 3) Couldn't open via API or gh — push succeeded, point at the compare URL.
  return {
    ok: true,
    branchPushed: true,
    ...(manualCompareUrl ? { manualCompareUrl } : {}),
    ...(apiError || gh.error
      ? { error: apiError ?? `pushed ok, but couldn't open the PR: ${gh.error}` }
      : {}),
  };
}

/**
 * Update an existing PR's description on GitHub (Octokit when a token is
 * set, else the `gh` CLI) and mirror it into the recorded row. Backs the
 * dashboard's "refresh the PR body on push" so the description reflects the
 * newly-pushed commits. Best-effort — never throws.
 */
export async function updatePrDescription(
  projectRoot: string,
  opts: { number: number; body: string },
): Promise<{ ok: boolean; error?: string }> {
  const remote = await resolveOriginRemote(projectRoot);
  if (!remote) return { ok: false, error: 'no GitHub remote' };

  const token = await resolveGithubToken(projectRoot);
  if (token) {
    try {
      const octokit = new Octokit({ auth: token });
      await octokit.pulls.update({
        owner: remote.owner,
        repo: remote.repo,
        pull_number: opts.number,
        body: opts.body,
      });
      await updatePullRequestBody(projectRoot, opts.number, opts.body).catch(() => {});
      return { ok: true };
    } catch {
      // Fall through to gh — it may be authed when the token isn't scoped.
    }
  }

  try {
    const res = await runCapture(
      'gh',
      ['pr', 'edit', String(opts.number), '--body', opts.body],
      projectRoot,
    );
    if (res.code === 0) {
      await updatePullRequestBody(projectRoot, opts.number, opts.body).catch(() => {});
      return { ok: true };
    }
    return { ok: false, error: res.stderr.trim() || res.stdout.trim() || `gh exited ${res.code}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Record an opened PR for the dock's PRs view + audit log. Best-effort. */
async function recordOpenedPr(
  projectRoot: string,
  opts: OpenPrOpts,
  number: number,
  url: string,
): Promise<void> {
  await recordPullRequest(projectRoot, {
    number,
    url,
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
      number,
      url,
      branch: opts.branchName,
      baseBranch: opts.baseBranch,
      title: opts.title,
      conversationIds: opts.conversationIds,
    },
  });
}

/**
 * Open a PR with the `gh` CLI (already-pushed branch). Returns the PR URL on
 * success. If the branch already has a PR, gh exits non-zero but prints the
 * existing URL — we surface that too so the dock can still flip to "View PR".
 * Returns `{ url: undefined }` when gh is missing/unauthed/errors.
 */
async function createPrViaGh(
  projectRoot: string,
  opts: OpenPrOpts,
): Promise<{ url?: string; error?: string }> {
  try {
    const res = await runCapture(
      'gh',
      [
        'pr',
        'create',
        '--head',
        opts.branchName,
        '--base',
        opts.baseBranch,
        '--title',
        opts.title,
        '--body',
        opts.body,
      ],
      projectRoot,
    );
    // gh prints the PR URL on stdout on success; on "already exists" it prints
    // the existing PR URL on stderr. Scan both.
    const url = extractPrUrl(`${res.stdout}\n${res.stderr}`);
    if (url) return { url };
    return { error: res.stderr.trim() || res.stdout.trim() || `gh exited ${res.code}` };
  } catch (e) {
    // ENOENT (gh not installed) or other spawn failure — treat as unavailable.
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** First `https://github.com/<owner>/<repo>/pull/<n>` URL in `text`, if any. */
export function extractPrUrl(text: string): string | undefined {
  return /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/.exec(text)?.[0];
}

/** Parse the numeric PR id from a GitHub PR URL. Null when it doesn't match. */
export function parsePrNumberFromUrl(url: string): number | null {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? Number(m[1]) : null;
}

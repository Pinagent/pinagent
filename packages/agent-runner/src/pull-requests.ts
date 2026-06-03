// SPDX-License-Identifier: Apache-2.0
/**
 * `listPullRequests` — read the dock's record of PRs the compose flow
 * has opened, newest activity first.
 *
 * Rows are written by `composePullRequest` on the success path. The read
 * side doesn't reach out to GitHub; `state` reflects whatever the last
 * `refreshPullRequests` (or the original insert, 'open') recorded. The
 * dock's "Refresh" action calls that reconcile path on demand.
 */
import { Octokit } from '@octokit/rest';
import { desc, eq, pullRequests } from '@pinagent/db';
import { getDb } from './db/client';
import { resolveOriginRemote } from './git-remote';
import { runCapture } from './git-utils';
import { resolveGithubToken } from './github-auth';

export interface PullRequestRecord {
  /** Stable id for React keys — the DB row id as a string. */
  id: string;
  number: number;
  url: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  state: 'open' | 'merged' | 'closed' | 'draft';
  conversationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export async function listPullRequests(projectRoot: string): Promise<PullRequestRecord[]> {
  const db = getDb(projectRoot);
  const rows = await db.select().from(pullRequests).orderBy(desc(pullRequests.updatedAt));
  return rows.map((r) => ({
    id: String(r.id),
    number: r.number,
    url: r.url,
    branch: r.branch,
    baseBranch: r.baseBranch,
    title: r.title,
    body: r.body,
    state: r.state,
    conversationIds: r.conversationIds,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface RecordedPullRequestInput {
  number: number;
  url: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  conversationIds: string[];
}

/**
 * Insert a row for a freshly-opened PR. Called by `composePullRequest`
 * after Octokit returns success; kept separate so the read path
 * (`listPullRequests`) and the write path don't share state beyond the
 * DB itself.
 */
export async function recordPullRequest(
  projectRoot: string,
  input: RecordedPullRequestInput,
): Promise<void> {
  const db = getDb(projectRoot);
  await db.insert(pullRequests).values({
    number: input.number,
    url: input.url,
    branch: input.branch,
    baseBranch: input.baseBranch,
    title: input.title,
    body: input.body,
    conversationIds: input.conversationIds,
  });
}

export type PullRequestState = PullRequestRecord['state'];

/**
 * Collapse GitHub's PR fields into our single `state` enum. GitHub
 * reports `state` as only 'open' | 'closed' and carries `merged` /
 * `draft` as separate flags — merged wins over closed, and draft only
 * applies while still open.
 */
export function mapGithubPrState(pr: {
  state: string;
  merged?: boolean | null;
  draft?: boolean | null;
}): PullRequestState {
  if (pr.merged) return 'merged';
  if (pr.state === 'closed') return 'closed';
  if (pr.draft) return 'draft';
  return 'open';
}

/**
 * Update a recorded PR's `state` (and `updatedAt`, from GitHub's own
 * timestamp when supplied) by PR number — unique within the repo.
 */
export async function updatePullRequestState(
  projectRoot: string,
  number: number,
  state: PullRequestState,
  updatedAtIso?: string,
): Promise<void> {
  const db = getDb(projectRoot);
  await db
    .update(pullRequests)
    .set({ state, updatedAt: updatedAtIso ? new Date(updatedAtIso) : new Date() })
    .where(eq(pullRequests.number, number));
}

/**
 * Update a recorded PR's `body` (and `updatedAt`) — written after the
 * dashboard refreshes the PR description on a push so the dock's PRs view
 * stays in sync with what's on GitHub.
 */
export async function updatePullRequestBody(
  projectRoot: string,
  number: number,
  body: string,
): Promise<void> {
  const db = getDb(projectRoot);
  await db
    .update(pullRequests)
    .set({ body, updatedAt: new Date() })
    .where(eq(pullRequests.number, number));
}

/**
 * Map the JSON `gh pr view` reports into our `state` enum. gh uses uppercase
 * `state` (OPEN | CLOSED | MERGED) and a separate `isDraft` flag.
 */
export function mapGhPrState(gh: {
  state?: string;
  isDraft?: boolean | null;
  mergedAt?: string | null;
}): PullRequestState {
  if (gh.state === 'MERGED' || gh.mergedAt) return 'merged';
  if (gh.state === 'CLOSED') return 'closed';
  if (gh.isDraft) return 'draft';
  return 'open';
}

/** Read one PR's current state via the `gh` CLI. Null when gh is unavailable. */
async function fetchPrStateViaGh(
  projectRoot: string,
  number: number,
): Promise<{ state: PullRequestState; updatedAt?: string } | null> {
  try {
    const res = await runCapture(
      'gh',
      ['pr', 'view', String(number), '--json', 'state,isDraft,mergedAt,updatedAt'],
      projectRoot,
    );
    if (res.code !== 0) return null;
    const j = JSON.parse(res.stdout) as {
      state?: string;
      isDraft?: boolean;
      mergedAt?: string | null;
      updatedAt?: string;
    };
    return { state: mapGhPrState(j), updatedAt: j.updatedAt };
  } catch {
    return null;
  }
}

/**
 * Reconcile every recorded PR's state against GitHub, then return the
 * refreshed list. Uses Octokit when a token is configured, otherwise the
 * `gh` CLI (so `gh`-only auth — no stored token — still reconciles; without
 * this the Refresh button did nothing for those users and a closed/merged PR
 * stayed "open" in the dock). Best-effort per PR: a deleted PR / network blip
 * keeps the prior state.
 */
export async function refreshPullRequests(projectRoot: string): Promise<PullRequestRecord[]> {
  const remote = await resolveOriginRemote(projectRoot);
  if (!remote) return listPullRequests(projectRoot);

  const token = await resolveGithubToken(projectRoot);
  const octokit = token ? new Octokit({ auth: token }) : null;
  const current = await listPullRequests(projectRoot);
  for (const pr of current) {
    try {
      if (octokit) {
        const { data } = await octokit.pulls.get({
          owner: remote.owner,
          repo: remote.repo,
          pull_number: pr.number,
        });
        await updatePullRequestState(
          projectRoot,
          pr.number,
          mapGithubPrState(data),
          data.updated_at,
        );
      } else {
        const gh = await fetchPrStateViaGh(projectRoot, pr.number);
        if (gh) await updatePullRequestState(projectRoot, pr.number, gh.state, gh.updatedAt);
      }
    } catch {
      // Deleted PR, network blip, scope issue — keep the prior state.
    }
  }
  return listPullRequests(projectRoot);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * `listPullRequests` — read the dock's record of PRs the compose flow
 * has opened, newest activity first.
 *
 * Rows are written by `composePullRequest` on the success path; this
 * function is the read side. We don't reconcile against GitHub here —
 * `state` reflects what the composer knew at insert time ('open'). A
 * future refresh job can update `state` / `updatedAt` from the GitHub
 * API; the dock surfaces stale state as a known tradeoff.
 */
import { desc, pullRequests } from '@pinagent/db';
import { getDb } from './db/client';

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

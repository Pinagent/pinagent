// SPDX-License-Identifier: Apache-2.0
/**
 * `recordPullRequest` (write) + `listPullRequests` (read). The read path
 * orders by `updatedAt` descending and round-trips the `conversationIds`
 * JSON array; the row id is surfaced as a string for React keys.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pullRequests } from '@pinagent/db';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type PrMod = typeof import('../src/pull-requests');
type ClientMod = typeof import('../src/db/client');

let pr: PrMod;
let getDb: ClientMod['getDb'];

const PARENT = join(tmpdir(), `pa-pr-${nanoid(8)}`);

async function freshRoot(): Promise<string> {
  const root = join(PARENT, nanoid(8));
  await mkdir(root, { recursive: true });
  return root;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  await mkdir(PARENT, { recursive: true });
  pr = await import('../src/pull-requests');
  ({ getDb } = await import('../src/db/client'));
});

afterAll(async () => {
  await rm(PARENT, { recursive: true, force: true });
});

describe('recordPullRequest + listPullRequests', () => {
  it('returns [] on a project with no PRs', async () => {
    expect(await pr.listPullRequests(await freshRoot())).toEqual([]);
  });

  it('round-trips a recorded PR including the conversationIds array', async () => {
    const root = await freshRoot();
    await pr.recordPullRequest(root, {
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
      branch: 'pinagent/batch-1',
      baseBranch: 'main',
      title: 'Batch of fixes',
      body: 'Closes a few things',
      conversationIds: ['cv_a', 'cv_b', 'cv_c'],
    });

    const rows = await pr.listPullRequests(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
      branch: 'pinagent/batch-1',
      baseBranch: 'main',
      title: 'Batch of fixes',
      state: 'open',
      conversationIds: ['cv_a', 'cv_b', 'cv_c'],
    });
    // id is the DB row id surfaced as a string.
    expect(typeof rows[0]?.id).toBe('string');
    // Timestamps serialize to ISO strings.
    expect(rows[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lists multiple PRs newest-activity (updatedAt desc) first', async () => {
    const root = await freshRoot();
    const db = getDb(root);
    // Insert directly with explicit timestamps so ordering is deterministic
    // rather than relying on sub-millisecond insert timing.
    await db.insert(pullRequests).values({
      number: 1,
      url: 'u1',
      branch: 'b1',
      baseBranch: 'main',
      title: 'older',
      body: '',
      conversationIds: ['x'],
      createdAt: new Date(1_000),
      updatedAt: new Date(1_000),
    });
    await db.insert(pullRequests).values({
      number: 2,
      url: 'u2',
      branch: 'b2',
      baseBranch: 'main',
      title: 'newer',
      body: '',
      conversationIds: ['y'],
      createdAt: new Date(9_000),
      updatedAt: new Date(9_000),
    });

    const rows = await pr.listPullRequests(root);
    expect(rows.map((r) => r.title)).toEqual(['newer', 'older']);
  });
});

describe('mapGithubPrState', () => {
  it('maps merged PRs to "merged" (merged wins over closed state)', () => {
    expect(pr.mapGithubPrState({ state: 'closed', merged: true })).toBe('merged');
    expect(pr.mapGithubPrState({ state: 'open', merged: true, draft: true })).toBe('merged');
  });

  it('maps closed-but-unmerged PRs to "closed"', () => {
    expect(pr.mapGithubPrState({ state: 'closed', merged: false })).toBe('closed');
  });

  it('maps open draft PRs to "draft"', () => {
    expect(pr.mapGithubPrState({ state: 'open', merged: false, draft: true })).toBe('draft');
  });

  it('maps open non-draft PRs to "open"', () => {
    expect(pr.mapGithubPrState({ state: 'open', merged: false, draft: false })).toBe('open');
    // GitHub may omit the flags entirely on some payloads.
    expect(pr.mapGithubPrState({ state: 'open' })).toBe('open');
  });
});

describe('mapGhPrState', () => {
  it('maps `gh pr view` JSON (uppercase state + isDraft + mergedAt)', () => {
    expect(pr.mapGhPrState({ state: 'MERGED' })).toBe('merged');
    expect(pr.mapGhPrState({ state: 'CLOSED', mergedAt: '2026-06-01T00:00:00Z' })).toBe('merged');
    expect(pr.mapGhPrState({ state: 'CLOSED', mergedAt: null })).toBe('closed');
    expect(pr.mapGhPrState({ state: 'OPEN', isDraft: true })).toBe('draft');
    expect(pr.mapGhPrState({ state: 'OPEN', isDraft: false })).toBe('open');
    expect(pr.mapGhPrState({ state: 'OPEN' })).toBe('open');
  });
});

describe('updatePullRequestBody', () => {
  it('updates the recorded body for the matching PR number', async () => {
    const root = await freshRoot();
    await pr.recordPullRequest(root, {
      number: 9,
      url: 'https://github.com/acme/widgets/pull/9',
      branch: 'pinagent/nine',
      baseBranch: 'main',
      title: 'Nine',
      body: 'original body',
      conversationIds: [],
    });

    await pr.updatePullRequestBody(root, 9, '## Changes\n- pushed more work');

    const [row] = await pr.listPullRequests(root);
    expect(row?.body).toBe('## Changes\n- pushed more work');
  });
});

describe('updatePullRequestState', () => {
  it('updates state + updatedAt for the matching PR number', async () => {
    const root = await freshRoot();
    await pr.recordPullRequest(root, {
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      branch: 'pinagent/batch-7',
      baseBranch: 'main',
      title: 'Seven',
      body: '',
      conversationIds: ['cv_x'],
    });

    const ghUpdatedAt = '2026-05-29T12:00:00.000Z';
    await pr.updatePullRequestState(root, 7, 'merged', ghUpdatedAt);

    const [row] = await pr.listPullRequests(root);
    expect(row?.state).toBe('merged');
    expect(row?.updatedAt).toBe(ghUpdatedAt);
  });

  it('leaves other PRs untouched', async () => {
    const root = await freshRoot();
    await pr.recordPullRequest(root, {
      number: 1,
      url: 'u1',
      branch: 'b1',
      baseBranch: 'main',
      title: 'one',
      body: '',
      conversationIds: [],
    });
    await pr.recordPullRequest(root, {
      number: 2,
      url: 'u2',
      branch: 'b2',
      baseBranch: 'main',
      title: 'two',
      body: '',
      conversationIds: [],
    });

    await pr.updatePullRequestState(root, 2, 'closed');

    const rows = await pr.listPullRequests(root);
    expect(rows.find((r) => r.number === 1)?.state).toBe('open');
    expect(rows.find((r) => r.number === 2)?.state).toBe('closed');
  });
});

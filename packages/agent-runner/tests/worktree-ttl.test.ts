// SPDX-License-Identifier: Apache-2.0
/**
 * Phase H worktree TTL sweep: flag `active` worktrees whose `updatedAt`
 * is older than the configured TTL, leave fresh ones alone, honor the
 * disable switch (TTL=0), and let `clearWarning` drop a flag after the
 * user acts. The flag set is a process-global refreshed on each sweep.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversations } from '@pinagent/db';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

type TtlMod = typeof import('../src/worktree-ttl');
type ClientMod = typeof import('../src/db/client');

let ttl: TtlMod;
let getDb: ClientMod['getDb'];

const PARENT = join(tmpdir(), `pa-ttl-${nanoid(8)}`);
const DAY_MS = 24 * 60 * 60 * 1000;

async function freshRoot(): Promise<string> {
  const root = join(PARENT, nanoid(8));
  await mkdir(root, { recursive: true });
  return root;
}

async function seedActive(root: string, id: string, updatedAt: Date): Promise<void> {
  await getDb(root)
    .insert(conversations)
    .values({
      id,
      comment: 'wt',
      worktreeState: 'active',
      worktreePath: join(root, 'wt', id),
      branch: `pinagent/${id}`,
      createdAt: updatedAt,
      updatedAt,
    });
}

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  await mkdir(PARENT, { recursive: true });
  ttl = await import('../src/worktree-ttl');
  ({ getDb } = await import('../src/db/client'));
});

afterEach(() => {
  delete process.env.PINAGENT_WORKTREE_TTL_DAYS;
});

afterAll(async () => {
  await rm(PARENT, { recursive: true, force: true });
});

describe('sweepStaleWorktrees', () => {
  it('flags an active worktree older than the default 7-day TTL', async () => {
    const root = await freshRoot();
    await seedActive(root, 'cv_old', new Date(Date.now() - 10 * DAY_MS));
    await seedActive(root, 'cv_new', new Date(Date.now() - 1 * DAY_MS));

    await ttl.sweepStaleWorktrees(root);
    expect(ttl.isStale('cv_old')).toBe(true);
    expect(ttl.isStale('cv_new')).toBe(false);
  });

  it('respects PINAGENT_WORKTREE_TTL_DAYS for the cutoff', async () => {
    const root = await freshRoot();
    await seedActive(root, 'cv_2d', new Date(Date.now() - 2 * DAY_MS));
    // With a 1-day TTL, a 2-day-old worktree is stale.
    process.env.PINAGENT_WORKTREE_TTL_DAYS = '1';
    await ttl.sweepStaleWorktrees(root);
    expect(ttl.isStale('cv_2d')).toBe(true);
  });

  it('disables the sweep and clears the flag set when TTL=0', async () => {
    const root = await freshRoot();
    await seedActive(root, 'cv_disable', new Date(Date.now() - 100 * DAY_MS));
    await ttl.sweepStaleWorktrees(root);
    expect(ttl.isStale('cv_disable')).toBe(true);

    process.env.PINAGENT_WORKTREE_TTL_DAYS = '0';
    await ttl.sweepStaleWorktrees(root);
    expect(ttl.isStale('cv_disable')).toBe(false);
    expect(ttl._flaggedForTests().size).toBe(0);
  });

  it('does not flag worktrees that are not in the active state', async () => {
    const root = await freshRoot();
    await getDb(root)
      .insert(conversations)
      .values({
        id: 'cv_landed',
        comment: 'wt',
        worktreeState: 'landed',
        createdAt: new Date(Date.now() - 30 * DAY_MS),
        updatedAt: new Date(Date.now() - 30 * DAY_MS),
      });
    await ttl.sweepStaleWorktrees(root);
    expect(ttl.isStale('cv_landed')).toBe(false);
  });

  it('falls back to the default TTL for a non-numeric env value', async () => {
    const root = await freshRoot();
    await seedActive(root, 'cv_envbad', new Date(Date.now() - 10 * DAY_MS));
    process.env.PINAGENT_WORKTREE_TTL_DAYS = 'not-a-number';
    await ttl.sweepStaleWorktrees(root);
    // Default 7-day TTL still applies, so a 10-day-old worktree is stale.
    expect(ttl.isStale('cv_envbad')).toBe(true);
  });
});

describe('clearWarning', () => {
  it('drops a single flag without disturbing the rest', async () => {
    const root = await freshRoot();
    await seedActive(root, 'cv_keep', new Date(Date.now() - 10 * DAY_MS));
    await seedActive(root, 'cv_drop', new Date(Date.now() - 10 * DAY_MS));
    await ttl.sweepStaleWorktrees(root);
    expect(ttl.isStale('cv_keep')).toBe(true);
    expect(ttl.isStale('cv_drop')).toBe(true);

    ttl.clearWarning('cv_drop');
    expect(ttl.isStale('cv_drop')).toBe(false);
    expect(ttl.isStale('cv_keep')).toBe(true);
  });
});

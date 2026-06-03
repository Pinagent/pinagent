// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeRuns, conversations } from '@pinagent/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';

const DB_SINGLETON = Symbol.for('pinagent.db');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-active-runs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  // Drop any cached connection so the next test's getDb opens fresh.
  (globalThis as Record<symbol, Map<string, unknown> | undefined>)[DB_SINGLETON]?.clear();
});

describe('active_runs orphan sweep on boot', () => {
  it('clears stale active_runs rows the next time the DB is opened, keeping the conversation', async () => {
    const db = getDb(root);
    const now = new Date();
    await db
      .insert(conversations)
      .values({ id: 'c1', comment: 'x', status: 'pending', createdAt: now, updatedAt: now });
    // An orphan row (as a crashed prior run would have left).
    await db.insert(activeRuns).values({ conversationId: 'c1', startedAt: now, currentTurn: 1 });
    expect(await db.select().from(activeRuns)).toHaveLength(1);

    // Simulate a process restart: drop the cached connection so the next getDb
    // re-opens the file and runs the boot sweep.
    (globalThis as Record<symbol, Map<string, unknown> | undefined>)[DB_SINGLETON]?.clear();

    const db2 = getDb(root);
    expect(await db2.select().from(activeRuns)).toEqual([]); // orphan swept
    // The conversation itself is untouched (the sweep only clears active_runs).
    expect(await db2.select().from(conversations)).toHaveLength(1);
  });
});

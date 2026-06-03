// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from '@pinagent/db';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `pa-db-pragmas-${nanoid(8)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('db connection pragmas', () => {
  it('sets a busy_timeout so a write loser waits instead of throwing SQLITE_BUSY', async () => {
    // busy_timeout is per-connection, so assert it on the connection getDb
    // configured (the proxy projects a PRAGMA row to an array of its values).
    const db = getDb(root);
    const row = (await db.get(sql`PRAGMA busy_timeout`)) as unknown[];
    expect(Number(row[0])).toBe(5000);
  });

  it('opens the database in WAL journal mode', async () => {
    const db = getDb(root);
    const row = (await db.get(sql`PRAGMA journal_mode`)) as unknown[];
    expect(String(row[0]).toLowerCase()).toBe('wal');
  });
});

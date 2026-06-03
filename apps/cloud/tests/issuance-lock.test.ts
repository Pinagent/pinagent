// SPDX-License-Identifier: Elastic-2.0
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createPgIssuanceLock } from '../src/db/issuance-lock';

/**
 * PGlite is single-connection in-process, so it can't exercise cross-connection
 * serialization (that's the production advisory lock's job). These cover that
 * the adapter issues valid SQL, runs `fn` inside the transaction, and returns
 * its value — i.e. the wiring is correct.
 */
describe('createPgIssuanceLock (PGlite)', () => {
  it('acquires the advisory lock and returns the function result', async () => {
    const db = drizzle(new PGlite());
    const lock = createPgIssuanceLock(db);
    const result = await lock.withLock('acme', async () => 'value');
    expect(result).toBe('value');
  });

  it('runs back-to-back without leaking the lock (auto-released at commit)', async () => {
    const db = drizzle(new PGlite());
    const lock = createPgIssuanceLock(db);
    // If the xact lock leaked, a second acquisition of the same key would hang.
    await lock.withLock('acme', async () => undefined);
    await expect(lock.withLock('acme', async () => 'again')).resolves.toBe('again');
  });

  it('propagates a thrown error (and rolls back the lock transaction)', async () => {
    const db = drizzle(new PGlite());
    const lock = createPgIssuanceLock(db);
    await expect(
      lock.withLock('acme', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // The org is not wedged after the rollback.
    await expect(lock.withLock('acme', async () => 'ok')).resolves.toBe('ok');
  });
});

// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createInMemoryIssuanceLock } from '../src/issuance-lock';

/** A deferred — lets a test hold `fn` open to observe overlap. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createInMemoryIssuanceLock', () => {
  it('serializes calls for the same org (no overlap)', async () => {
    const lock = createInMemoryIssuanceLock();
    let active = 0;
    let maxActive = 0;
    const body = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve(); // yield — a second runner could interleave here
      active--;
    };
    await Promise.all([
      lock.withLock('acme', body),
      lock.withLock('acme', body),
      lock.withLock('acme', body),
    ]);
    expect(maxActive).toBe(1);
  });

  it('runs calls for different orgs concurrently', async () => {
    const lock = createInMemoryIssuanceLock();
    const a = deferred();
    const b = deferred();
    let aRunning = false;
    let bRunning = false;
    const pa = lock.withLock('org-a', async () => {
      aRunning = true;
      await a.promise;
    });
    const pb = lock.withLock('org-b', async () => {
      bRunning = true;
      await b.promise;
    });
    await Promise.resolve();
    // Both entered their critical sections — different orgs don't block.
    expect(aRunning && bRunning).toBe(true);
    a.resolve();
    b.resolve();
    await Promise.all([pa, pb]);
  });

  it('preserves arrival order for the same org', async () => {
    const lock = createInMemoryIssuanceLock();
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        lock.withLock('acme', async () => {
          await Promise.resolve();
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not wedge the queue when a holder rejects', async () => {
    const lock = createInMemoryIssuanceLock();
    const first = lock.withLock('acme', async () => {
      throw new Error('boom');
    });
    await expect(first).rejects.toThrow('boom');
    // The next holder still runs.
    await expect(lock.withLock('acme', async () => 'ok')).resolves.toBe('ok');
  });

  it('returns the function result', async () => {
    const lock = createInMemoryIssuanceLock();
    expect(await lock.withLock('acme', async () => 42)).toBe(42);
  });
});

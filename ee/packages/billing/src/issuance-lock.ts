// SPDX-License-Identifier: Elastic-2.0

/**
 * Per-organization serialization for session issuance.
 *
 * The quota + cost-cap gate is a read-modify-write over usage: read the
 * period's totals, decide whether one more unit fits, then record that unit.
 * Without mutual exclusion two concurrent issuances for the same org can both
 * read the same total, both pass the cap, and both record — overshooting the
 * limit (a TOCTOU race). `withLock` runs the gate under an exclusive per-org
 * lock so they serialize; different orgs never block each other.
 *
 * This is the driver-free core: the port plus an in-memory impl for tests/dev
 * and single-process deploys. The Postgres adapter (a `pg_advisory_xact_lock`,
 * which also serializes across Worker isolates / instances) lives in the cloud
 * app — the same port/adapter split as the meter and subscription stores.
 */
export interface IssuanceLock {
  /**
   * Run `fn` while holding an exclusive lock for `organizationId`. Calls for the
   * same org run one at a time, in arrival order; calls for different orgs run
   * concurrently. Resolves/rejects with whatever `fn` returns/throws.
   */
  withLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * In-memory {@link IssuanceLock} — a per-org promise chain (mutex). Suitable for
 * tests and any single-process deploy. Does NOT serialize across processes /
 * isolates; a multi-instance deploy needs the Postgres adapter.
 */
export function createInMemoryIssuanceLock(): IssuanceLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    withLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
      const prior = tails.get(organizationId) ?? Promise.resolve();
      // Run `fn` once the prior holder settles — whether it resolved OR rejected
      // (a failed issuance must not wedge the org's queue).
      const result = prior.then(fn, fn);
      // The tail swallows the outcome so the next waiter always proceeds.
      const tail = result.then(
        () => {},
        () => {},
      );
      tails.set(organizationId, tail);
      // Drop the entry once we're the last in line, to bound the map.
      tail.then(() => {
        if (tails.get(organizationId) === tail) tails.delete(organizationId);
      });
      return result;
    },
  };
}

// SPDX-License-Identifier: Elastic-2.0
import type { IssuanceLock } from '@pinagent/ee-billing';
import { sql } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';

/**
 * Postgres-backed {@link IssuanceLock} using a transaction-scoped advisory lock.
 * Unlike the in-memory mutex, this serializes issuance for an org across every
 * Worker isolate / instance hitting the same database.
 *
 * `pg_advisory_xact_lock` blocks until the lock is held and auto-releases at
 * COMMIT/ROLLBACK, so the lock lives exactly as long as the surrounding
 * transaction — no explicit unlock to leak. `fn` runs its own queries on the
 * pool (a separate connection); serialization still holds because every
 * issuance for the org acquires this same lock first, and `fn`'s metered write
 * has committed by the time `fn` resolves, before we release the lock.
 *
 * Trade-off: the lock transaction stays open for `fn`'s duration (a few
 * round-trips), holding one pooled connection. Acceptable for session issuance,
 * which isn't high-throughput per org.
 */

/**
 * Fixed first key for `pg_advisory_xact_lock(int4, int4)` so our issuance locks
 * occupy a private namespace that can't collide with any other feature's
 * advisory locks. ASCII for "pina"; within int4 range.
 */
const LOCK_NAMESPACE = 0x70696e61;

export function createPgIssuanceLock(db: MembershipDb): IssuanceLock {
  return {
    withLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${organizationId}))`,
        );
        return fn();
      });
    },
  };
}

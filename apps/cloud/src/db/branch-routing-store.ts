// SPDX-License-Identifier: Elastic-2.0
import type { BranchRoutingPolicy, BranchRoutingStore } from '@pinagent/ee-team-features';
import { eq } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';
import { branchRouting } from './schema';

/**
 * Postgres-backed {@link BranchRoutingStore} (the `team.branch_routing` table)
 * — one row per org. Drizzle query builder, so it runs on Neon (prod) and
 * PGlite (tests).
 */
export function createPgBranchRoutingStore(db: MembershipDb): BranchRoutingStore {
  return {
    async get(organizationId: string): Promise<BranchRoutingPolicy | null> {
      const [row] = await db
        .select()
        .from(branchRouting)
        .where(eq(branchRouting.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      return {
        organizationId: row.organizationId,
        defaultBaseBranch: row.defaultBaseBranch,
        allowedBranchPatterns: row.allowedBranchPatterns,
      };
    },

    async upsert(policy: BranchRoutingPolicy): Promise<void> {
      await db
        .insert(branchRouting)
        .values(policy)
        .onConflictDoUpdate({
          target: branchRouting.organizationId,
          set: {
            defaultBaseBranch: policy.defaultBaseBranch,
            allowedBranchPatterns: policy.allowedBranchPatterns,
          },
        });
    },
  };
}

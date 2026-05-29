// SPDX-License-Identifier: Elastic-2.0
import type {
  CostControl,
  CostControlEnforcement,
  CostControlStore,
} from '@pinagent/ee-team-features';
import { eq } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';
import { costControls } from './schema';

/**
 * Postgres-backed {@link CostControlStore} (the `team.cost_controls` table) —
 * one row per org. Drizzle query builder, so it runs on Neon (prod) and
 * PGlite (tests).
 */
export function createPgCostControlStore(db: MembershipDb): CostControlStore {
  return {
    async get(organizationId: string): Promise<CostControl | null> {
      const [row] = await db
        .select()
        .from(costControls)
        .where(eq(costControls.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      return {
        organizationId: row.organizationId,
        maxRelaySessionsPerPeriod: row.maxRelaySessionsPerPeriod,
        enforcement: row.enforcement as CostControlEnforcement,
      };
    },

    async upsert(control: CostControl): Promise<void> {
      await db
        .insert(costControls)
        .values(control)
        .onConflictDoUpdate({
          target: costControls.organizationId,
          set: {
            maxRelaySessionsPerPeriod: control.maxRelaySessionsPerPeriod,
            enforcement: control.enforcement,
          },
        });
    },
  };
}

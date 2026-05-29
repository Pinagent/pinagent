// SPDX-License-Identifier: Elastic-2.0
import type { MeterSink, UsageSummary } from '@pinagent/ee-billing';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';
import { usageEvents } from './schema';

/**
 * Postgres-backed {@link MeterSink} (the `billing.usage_events` table). Append
 * + summed read-back over the Drizzle query builder, so it runs on any pg
 * driver (Neon in prod, PGlite in tests). Row id is an app-generated UUID.
 */
export function createPgMeterSink(db: MembershipDb): MeterSink {
  return {
    async record(event): Promise<void> {
      await db.insert(usageEvents).values({
        id: crypto.randomUUID(),
        occurredAt: event.occurredAt,
        organizationId: event.organizationId,
        kind: event.kind,
        quantity: event.quantity,
        metadata: event.metadata ?? null,
      });
    },

    async summarize(query): Promise<UsageSummary> {
      const scope = query.since
        ? and(
            eq(usageEvents.organizationId, query.organizationId),
            gte(usageEvents.occurredAt, query.since),
          )
        : eq(usageEvents.organizationId, query.organizationId);
      const rows = await db
        .select({ kind: usageEvents.kind, total: sql<number>`sum(${usageEvents.quantity})::int` })
        .from(usageEvents)
        .where(scope)
        .groupBy(usageEvents.kind);
      const totals: UsageSummary = {};
      for (const row of rows) totals[row.kind] = Number(row.total);
      return totals;
    },
  };
}

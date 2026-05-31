// SPDX-License-Identifier: Elastic-2.0
import type { Subscription, SubscriptionStore } from '@pinagent/ee-billing';
import { eq } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';
import { subscriptions } from './schema';

/**
 * Postgres-backed {@link SubscriptionStore} (the `billing.subscriptions`
 * table) — one row per org mapping it to a plan + current billing period.
 * Drizzle query builder, so it runs on Neon (prod) and PGlite (tests).
 */
export function createPgSubscriptionStore(db: MembershipDb): SubscriptionStore {
  return {
    async get(organizationId: string): Promise<Subscription | null> {
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      return row ?? null;
    },

    async listAll(): Promise<Subscription[]> {
      return db.select().from(subscriptions);
    },

    async upsert(subscription: Subscription): Promise<void> {
      await db
        .insert(subscriptions)
        .values(subscription)
        .onConflictDoUpdate({
          target: subscriptions.organizationId,
          set: {
            planId: subscription.planId,
            currentPeriodStart: subscription.currentPeriodStart,
          },
        });
    },
  };
}

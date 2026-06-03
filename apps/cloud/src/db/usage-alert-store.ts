// SPDX-License-Identifier: Elastic-2.0
import type { UsageAlertClaim, UsageAlertStore } from '@pinagent/ee-billing';
import type { MembershipDb } from './membership-store';
import { usageAlerts } from './schema';

/**
 * Postgres-backed {@link UsageAlertStore} (the `billing.usage_alerts` table).
 * `claim` is an atomic `INSERT … ON CONFLICT DO NOTHING RETURNING`: the row's
 * composite PK `(org, period, severity)` means exactly one caller inserts and
 * gets a row back, so the alert is sent once per period even across isolates
 * and without the issuance lock. `alertedAt` is informational only.
 */
export function createPgUsageAlertStore(db: MembershipDb): UsageAlertStore {
  return {
    async claim({ organizationId, periodStart, severity }: UsageAlertClaim): Promise<boolean> {
      const inserted = await db
        .insert(usageAlerts)
        .values({ organizationId, periodStart, severity, alertedAt: new Date().toISOString() })
        .onConflictDoNothing()
        .returning();
      return inserted.length > 0;
    },
  };
}

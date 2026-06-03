// SPDX-License-Identifier: Elastic-2.0

/**
 * Usage metering for the cloud — append-only billable-usage events plus a
 * per-organization summary the billing logic (and, later, Stripe reporting)
 * reads back.
 *
 * Driver-free domain core: the event shape, the `MeterSink` port, and an
 * in-memory implementation. The Postgres-backed sink lives in the cloud app —
 * the same interface/adapter split as `ee-auth`'s `MembershipStore` and
 * `ee-team-features`'s `AuditSink`.
 */

/** The metered usage kinds the control plane reports. */
export const USAGE_KINDS = {
  /** One relay session granted (a `POST /sessions` success). */
  relaySession: 'relay.session',
  /** Connection time, in seconds — summed from relay disconnect durations. */
  relayConnectionSeconds: 'relay.connection.seconds',
} as const;

export interface UsageEvent {
  /** When the usage occurred, ISO-8601. */
  occurredAt: string;
  organizationId: string;
  /** What was used — see {@link USAGE_KINDS}. */
  kind: string;
  /** How much (e.g. 1 session). Must be a non-negative integer. */
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface UsageQuery {
  organizationId: string;
  /** Only count events at/after this ISO timestamp (e.g. billing-period start). */
  since?: string;
  /**
   * Only count events strictly *before* this ISO timestamp — the half-open
   * window `[since, until)`. Used to bill exactly one closed billing period at
   * rollover (so usage already accruing in the new period isn't billed to the
   * old one). Omit for an open-ended window up to now.
   */
  until?: string;
}

/** Totals by usage kind for one organization. */
export type UsageSummary = Record<string, number>;

/** Persistence boundary for usage. Append + summarize. */
export interface MeterSink {
  record(event: UsageEvent): Promise<void>;
  summarize(query: UsageQuery): Promise<UsageSummary>;
}

/** In-memory sink for tests and local dev. Not durable. */
export function createInMemoryMeterSink(): MeterSink & { readonly events: readonly UsageEvent[] } {
  const events: UsageEvent[] = [];
  return {
    events,
    async record(event: UsageEvent): Promise<void> {
      events.push(event);
    },
    async summarize(query: UsageQuery): Promise<UsageSummary> {
      const totals: UsageSummary = {};
      for (const e of events) {
        if (e.organizationId !== query.organizationId) continue;
        if (query.since !== undefined && e.occurredAt < query.since) continue;
        if (query.until !== undefined && e.occurredAt >= query.until) continue;
        totals[e.kind] = (totals[e.kind] ?? 0) + e.quantity;
      }
      return totals;
    },
  };
}

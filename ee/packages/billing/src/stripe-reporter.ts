// SPDX-License-Identifier: Elastic-2.0
import type { MeterSink } from './metering';
import type { BillingReporter, PeriodRolloverEvent } from './reporter';
import type { SubscriptionStore } from './subscriptions';

/**
 * Stripe-backed {@link BillingReporter}: on each billing-period rollover it
 * reports the just-closed period's metered usage to Stripe as a Billing Meter
 * Event, keyed by the org's Stripe customer.
 *
 * ee-billing stays dependency-light — it talks to Stripe only through the
 * narrow {@link StripeBillingClient} port. The fetch/SDK-backed adapter lives
 * in the cloud app (the composition root owns credentials), the same split as
 * the meter and subscription stores.
 */

/** A single Stripe Billing Meter Event — the one call the reporter makes. */
export interface StripeMeterEvent {
  /** The Stripe meter's `event_name` (matches the meter configured in Stripe). */
  eventName: string;
  /** The Stripe customer the usage belongs to. */
  customerId: string;
  /** Usage quantity for the closed period. */
  value: number;
  /** Idempotency key so a retried rollover doesn't double-report. */
  identifier: string;
  /** When the usage is attributed (ISO-8601) — the closed period's end. */
  timestamp: string;
}

/** Narrow port over Stripe's Billing Meter Events API. */
export interface StripeBillingClient {
  recordMeterEvent(event: StripeMeterEvent): Promise<void>;
}

export interface StripeReporterDeps {
  client: StripeBillingClient;
  /** Resolves the org's subscription — the reporter reads `stripeCustomerId`. */
  subscriptions: SubscriptionStore;
  /** Source of metered usage to bill. */
  meter: MeterSink;
  /** The usage kind to report (e.g. `USAGE_KINDS.relaySession`). */
  usageKind: string;
  /** The Stripe meter `event_name` to post against. */
  eventName: string;
}

/**
 * Build a Stripe-backed reporter.
 *
 * Per rollover it reads the org's Stripe customer and the usage in the closed
 * window `[previousPeriodStart, newPeriodStart)`, then posts one meter event.
 * Skips silently when the org has no Stripe customer (not billed via Stripe) or
 * recorded zero usage (nothing to report). The `identifier` makes a retried
 * rollover idempotent on Stripe's side.
 *
 * The half-open `until` bound means usage already accruing in the new period is
 * never attributed to the closed one, even though the rollover service reports
 * before advancing the subscription's period.
 */
export function createStripeReporter(deps: StripeReporterDeps): BillingReporter {
  return {
    async reportPeriodRollover(event: PeriodRolloverEvent): Promise<void> {
      const subscription = await deps.subscriptions.get(event.organizationId);
      const customerId = subscription?.stripeCustomerId;
      if (!customerId) return; // org isn't billed through Stripe

      // Bill exactly the closed period `[previousPeriodStart, newPeriodStart)`,
      // so usage already accruing in the new period isn't attributed here.
      const usage = await deps.meter.summarize({
        organizationId: event.organizationId,
        since: event.previousPeriodStart,
        until: event.newPeriodStart,
      });
      const value = usage[deps.usageKind] ?? 0;
      if (value <= 0) return; // nothing to bill

      await deps.client.recordMeterEvent({
        eventName: deps.eventName,
        customerId,
        value,
        identifier: `${event.organizationId}:${event.previousPeriodStart}`,
        timestamp: event.newPeriodStart,
      });
    },
  };
}

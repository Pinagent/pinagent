// SPDX-License-Identifier: Elastic-2.0
import type { StripeBillingClient, StripeMeterEvent } from '@pinagent/ee-billing';

/**
 * `StripeBillingClient` adapter over Stripe's Billing Meter Events REST API.
 *
 * Implemented with `fetch` (form-encoded POST + Bearer secret key) rather than
 * the `stripe` SDK so the cloud Worker stays dependency-light and `workerd`-
 * compatible — no Node-only SDK internals. The narrow port keeps ee-billing
 * provider-agnostic; this is the only place a Stripe credential is used.
 *
 * Wired in only when `STRIPE_SECRET_KEY` + `STRIPE_METER_EVENT_NAME` are set;
 * otherwise the rollover uses `noopBillingReporter` (see `worker.ts`).
 */
export interface StripeMeterClientOptions {
  /** Stripe API base; override for tests. */
  baseUrl?: string;
  /** Injectable fetch for tests; defaults to the global. */
  fetch?: typeof fetch;
}

const STRIPE_API_BASE = 'https://api.stripe.com';

export function createStripeMeterClient(
  secretKey: string,
  options: StripeMeterClientOptions = {},
): StripeBillingClient {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? STRIPE_API_BASE;
  return {
    async recordMeterEvent(event: StripeMeterEvent): Promise<void> {
      // https://docs.stripe.com/api/billing/meter-event/create — form-encoded,
      // usage nested under `payload[...]`, `timestamp` in unix seconds.
      const body = new URLSearchParams({
        event_name: event.eventName,
        identifier: event.identifier,
        timestamp: String(Math.floor(Date.parse(event.timestamp) / 1000)),
        'payload[stripe_customer_id]': event.customerId,
        'payload[value]': String(event.value),
      });
      const response = await doFetch(`${baseUrl}/v1/billing/meter_events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Defence-in-depth alongside `identifier`: a retried POST is a no-op.
          'Idempotency-Key': event.identifier,
        },
        body: body.toString(),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Stripe meter event failed (${response.status}): ${detail.slice(0, 200)}`);
      }
    },
  };
}

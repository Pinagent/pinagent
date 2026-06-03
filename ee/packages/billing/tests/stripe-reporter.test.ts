// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createInMemoryMeterSink } from '../src/metering';
import type { PeriodRolloverEvent } from '../src/reporter';
import { createStripeReporter, type StripeMeterEvent } from '../src/stripe-reporter';
import { createInMemorySubscriptionStore } from '../src/subscriptions';

const USAGE_KIND = 'relay.session';
const EVENT_NAME = 'relay_sessions';

const rollover: PeriodRolloverEvent = {
  organizationId: 'acme',
  planId: 'pro',
  previousPeriodStart: '2026-04-01T00:00:00.000Z',
  newPeriodStart: '2026-05-01T00:00:00.000Z',
};

/** A client that records every meter event it's asked to send. */
function recordingClient() {
  const events: StripeMeterEvent[] = [];
  return {
    events,
    async recordMeterEvent(event: StripeMeterEvent) {
      events.push(event);
    },
  };
}

async function meterWith(org: string, count: number, kind = USAGE_KIND) {
  const meter = createInMemoryMeterSink();
  for (let i = 0; i < count; i++) {
    await meter.record({
      occurredAt: '2026-04-15T00:00:00.000Z',
      organizationId: org,
      kind,
      quantity: 1,
    });
  }
  return meter;
}

describe('createStripeReporter', () => {
  it('reports the closed period usage as a meter event for the org customer', async () => {
    const client = recordingClient();
    const subscriptions = createInMemorySubscriptionStore([
      {
        organizationId: 'acme',
        planId: 'pro',
        currentPeriodStart: '2026-05-01T00:00:00.000Z',
        stripeCustomerId: 'cus_123',
      },
    ]);
    const meter = await meterWith('acme', 7);
    const reporter = createStripeReporter({
      client,
      subscriptions,
      meter,
      usageKind: USAGE_KIND,
      eventName: EVENT_NAME,
    });

    await reporter.reportPeriodRollover(rollover);

    expect(client.events).toEqual([
      {
        eventName: EVENT_NAME,
        customerId: 'cus_123',
        value: 7,
        identifier: 'acme:2026-04-01T00:00:00.000Z',
        timestamp: '2026-05-01T00:00:00.000Z',
      },
    ]);
  });

  it('bills only the closed window, excluding usage already in the new period', async () => {
    const client = recordingClient();
    const subscriptions = createInMemorySubscriptionStore([
      {
        organizationId: 'acme',
        planId: 'pro',
        currentPeriodStart: '2026-05-01T00:00:00.000Z',
        stripeCustomerId: 'cus_123',
      },
    ]);
    const meter = createInMemoryMeterSink();
    // 3 in the closed window [2026-04-01, 2026-05-01)…
    for (let i = 0; i < 3; i++) {
      await meter.record({
        occurredAt: '2026-04-20T00:00:00.000Z',
        organizationId: 'acme',
        kind: USAGE_KIND,
        quantity: 1,
      });
    }
    // …and 2 already in the new period (at/after newPeriodStart) — must NOT bill.
    for (const occurredAt of ['2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.000Z']) {
      await meter.record({ occurredAt, organizationId: 'acme', kind: USAGE_KIND, quantity: 1 });
    }
    const reporter = createStripeReporter({
      client,
      subscriptions,
      meter,
      usageKind: USAGE_KIND,
      eventName: EVENT_NAME,
    });

    await reporter.reportPeriodRollover(rollover);
    expect(client.events).toHaveLength(1);
    expect(client.events[0]?.value).toBe(3); // only the closed-window events
  });

  it('skips an org with no Stripe customer', async () => {
    const client = recordingClient();
    const subscriptions = createInMemorySubscriptionStore([
      { organizationId: 'acme', planId: 'pro', currentPeriodStart: '2026-05-01T00:00:00.000Z' },
    ]);
    const meter = await meterWith('acme', 7);
    const reporter = createStripeReporter({
      client,
      subscriptions,
      meter,
      usageKind: USAGE_KIND,
      eventName: EVENT_NAME,
    });

    await reporter.reportPeriodRollover(rollover);
    expect(client.events).toHaveLength(0);
  });

  it('skips when there is no subscription at all', async () => {
    const client = recordingClient();
    const reporter = createStripeReporter({
      client,
      subscriptions: createInMemorySubscriptionStore(),
      meter: await meterWith('acme', 7),
      usageKind: USAGE_KIND,
      eventName: EVENT_NAME,
    });
    await reporter.reportPeriodRollover(rollover);
    expect(client.events).toHaveLength(0);
  });

  it('skips when the closed period recorded zero usage', async () => {
    const client = recordingClient();
    const subscriptions = createInMemorySubscriptionStore([
      {
        organizationId: 'acme',
        planId: 'pro',
        currentPeriodStart: '2026-05-01T00:00:00.000Z',
        stripeCustomerId: 'cus_123',
      },
    ]);
    const reporter = createStripeReporter({
      client,
      subscriptions,
      meter: await meterWith('acme', 0),
      usageKind: USAGE_KIND,
      eventName: EVENT_NAME,
    });
    await reporter.reportPeriodRollover(rollover);
    expect(client.events).toHaveLength(0);
  });
});

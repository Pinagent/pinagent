// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createInMemoryMeterSink, USAGE_KINDS } from '../src/metering';
import { checkQuota, createInMemorySubscriptionStore } from '../src/subscriptions';

const KIND = USAGE_KINDS.relaySession;

async function meterWith(count: number, organizationId = 'acme') {
  const meter = createInMemoryMeterSink();
  for (let i = 0; i < count; i++) {
    await meter.record({
      occurredAt: '2026-05-15T00:00:00Z',
      organizationId,
      kind: KIND,
      quantity: 1,
    });
  }
  return meter;
}

describe('checkQuota', () => {
  it('allows when usage + 1 is within the plan limit', async () => {
    const subscriptions = createInMemorySubscriptionStore([
      { organizationId: 'acme', planId: 'free', currentPeriodStart: '2026-05-01T00:00:00Z' },
    ]);
    const meter = await meterWith(50); // free limit is 100
    const decision = await checkQuota(
      { subscriptions, meter },
      { organizationId: 'acme', kind: KIND },
    );
    expect(decision).toMatchObject({ allowed: true, used: 50, limit: 100 });
    expect(decision.plan.id).toBe('free');
  });

  it('denies when one more would exceed the limit', async () => {
    const subscriptions = createInMemorySubscriptionStore([
      { organizationId: 'acme', planId: 'free', currentPeriodStart: '2026-05-01T00:00:00Z' },
    ]);
    const meter = await meterWith(100); // at the cap
    const decision = await checkQuota(
      { subscriptions, meter },
      { organizationId: 'acme', kind: KIND },
    );
    expect(decision.allowed).toBe(false);
  });

  it('only counts usage since the current period start', async () => {
    const subscriptions = createInMemorySubscriptionStore([
      { organizationId: 'acme', planId: 'free', currentPeriodStart: '2026-05-01T00:00:00Z' },
    ]);
    const meter = createInMemoryMeterSink();
    // 200 last period (ignored) + 1 this period.
    await meter.record({
      occurredAt: '2026-04-01T00:00:00Z',
      organizationId: 'acme',
      kind: KIND,
      quantity: 200,
    });
    await meter.record({
      occurredAt: '2026-05-10T00:00:00Z',
      organizationId: 'acme',
      kind: KIND,
      quantity: 1,
    });
    const decision = await checkQuota(
      { subscriptions, meter },
      { organizationId: 'acme', kind: KIND },
    );
    expect(decision).toMatchObject({ allowed: true, used: 1 });
  });

  it('falls back to the free plan when there is no subscription', async () => {
    const subscriptions = createInMemorySubscriptionStore();
    const meter = await meterWith(100);
    const decision = await checkQuota(
      { subscriptions, meter },
      { organizationId: 'acme', kind: KIND },
    );
    expect(decision.plan.id).toBe('free');
    expect(decision.allowed).toBe(false); // free default, at cap
  });

  it('treats an unlimited plan as always allowed', async () => {
    const subscriptions = createInMemorySubscriptionStore([
      { organizationId: 'acme', planId: 'enterprise', currentPeriodStart: '2026-05-01T00:00:00Z' },
    ]);
    const meter = await meterWith(1_000_000);
    const decision = await checkQuota(
      { subscriptions, meter },
      { organizationId: 'acme', kind: KIND },
    );
    expect(decision).toMatchObject({ allowed: true, limit: null });
  });
});

// SPDX-License-Identifier: Elastic-2.0
import {
  advanceElapsedPeriods,
  createInMemorySubscriptionStore,
  nextPeriodStart,
  planById,
  type Subscription,
} from '@pinagent/ee-billing';
import { describe, expect, it } from 'vitest';

const START = '2026-01-01T00:00:00.000Z';

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return { organizationId: 'acme', planId: 'pro', currentPeriodStart: START, ...overrides };
}

describe('nextPeriodStart', () => {
  it('leaves the period unchanged before a full interval has elapsed', () => {
    expect(nextPeriodStart(START, 30, '2026-01-15T00:00:00.000Z')).toBe(START);
    // exactly at the boundary is still "inside" until strictly past it
    expect(nextPeriodStart(START, 30, '2026-01-30T23:59:59.000Z')).toBe(START);
  });

  it('advances one interval once it elapses', () => {
    // 2026-01-01 + 30d = 2026-01-31
    expect(nextPeriodStart(START, 30, '2026-02-05T00:00:00.000Z')).toBe('2026-01-31T00:00:00.000Z');
  });

  it('collapses many missed periods into a single advance', () => {
    // ~99 days in → 3 whole intervals → 2026-01-01 + 90d = 2026-04-01
    expect(nextPeriodStart(START, 30, '2026-04-10T00:00:00.000Z')).toBe('2026-04-01T00:00:00.000Z');
  });

  it('is a no-op for a non-positive interval and passes through bad dates', () => {
    expect(nextPeriodStart(START, 0, '2027-01-01T00:00:00.000Z')).toBe(START);
    expect(nextPeriodStart('not-a-date', 30, '2026-06-01T00:00:00.000Z')).toBe('not-a-date');
  });
});

describe('advanceElapsedPeriods', () => {
  it('returns only the subscriptions whose period actually moved', () => {
    const fresh = sub({ organizationId: 'fresh', currentPeriodStart: '2026-06-01T00:00:00.000Z' });
    const stale = sub({ organizationId: 'stale', currentPeriodStart: START });
    const rolls = advanceElapsedPeriods([fresh, stale], '2026-06-10T00:00:00.000Z', planById);

    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({
      previousPeriodStart: START,
      newPeriodStart: '2026-05-31T00:00:00.000Z', // Jan 1 + 5×30d = May 31
    });
    expect(rolls[0]?.subscription.organizationId).toBe('stale');
  });

  it('falls back to the default plan interval for an unknown plan id', () => {
    const rolls = advanceElapsedPeriods(
      [sub({ planId: 'mystery' })],
      '2026-03-01T00:00:00.000Z',
      planById,
    );
    expect(rolls).toHaveLength(1); // default plan (30d) still elapses
  });
});

describe('SubscriptionStore.listAll', () => {
  it('enumerates every seeded subscription', async () => {
    const store = createInMemorySubscriptionStore([
      sub({ organizationId: 'a' }),
      sub({ organizationId: 'b' }),
    ]);
    expect((await store.listAll()).map((s) => s.organizationId).sort()).toEqual(['a', 'b']);
  });
});

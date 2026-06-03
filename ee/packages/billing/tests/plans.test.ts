// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import {
  isSelfServiceablePlan,
  planById,
  quotaFor,
  quotaStatus,
  wouldExceedQuota,
} from '../src/plans';

describe('plans', () => {
  it('looks up plans by id', () => {
    expect(planById('pro')?.name).toBe('Pro');
    expect(planById('nope')).toBeNull();
  });

  it('reports per-kind quota, null = unlimited', () => {
    const free = planById('free') as NonNullable<ReturnType<typeof planById>>;
    const ent = planById('enterprise') as NonNullable<ReturnType<typeof planById>>;
    expect(quotaFor(free, 'relay.session')).toBe(100);
    expect(quotaFor(ent, 'relay.session')).toBeNull(); // unlimited
    expect(quotaFor(free, 'unknown.kind')).toBeNull();
  });

  it('detects when recording more would exceed the limit', () => {
    const free = planById('free') as NonNullable<ReturnType<typeof planById>>;
    expect(wouldExceedQuota(free, 'relay.session', 99, 1)).toBe(false); // 99 + 1 = 100, at limit
    expect(wouldExceedQuota(free, 'relay.session', 100, 1)).toBe(true); // over
    // Unlimited kinds never exceed.
    const ent = planById('enterprise') as NonNullable<ReturnType<typeof planById>>;
    expect(wouldExceedQuota(ent, 'relay.session', 1_000_000)).toBe(false);
  });

  it('summarizes quota status against usage', () => {
    const free = planById('free') as NonNullable<ReturnType<typeof planById>>;
    const status = quotaStatus(free, { 'relay.session': 150 });
    expect(status).toContainEqual({ kind: 'relay.session', used: 150, limit: 100, exceeded: true });
  });

  it('marks finite plans self-serviceable and unlimited/unknown plans not', () => {
    expect(isSelfServiceablePlan('free')).toBe(true);
    expect(isSelfServiceablePlan('pro')).toBe(true);
    // Unlimited enterprise is internal-only — can't be self-assigned.
    expect(isSelfServiceablePlan('enterprise')).toBe(false);
    // Unknown plans are never self-serviceable.
    expect(isSelfServiceablePlan('platinum')).toBe(false);
  });
});

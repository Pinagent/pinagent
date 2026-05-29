// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import {
  type CostControl,
  createInMemoryCostControlStore,
  evaluateCostControl,
} from '../src/cost-controls';

function control(overrides: Partial<CostControl> = {}): CostControl {
  return {
    organizationId: 'acme',
    maxRelaySessionsPerPeriod: 100,
    enforcement: 'block',
    ...overrides,
  };
}

describe('evaluateCostControl', () => {
  it('allows when there is no control', () => {
    expect(evaluateCostControl(null, 999)).toMatchObject({ allowed: true, enforcement: 'none' });
  });

  it('allows when the cap is null (no cap)', () => {
    const d = evaluateCostControl(control({ maxRelaySessionsPerPeriod: null }), 999);
    expect(d).toMatchObject({ allowed: true, overCap: false, cap: null });
  });

  it('allows up to the cap', () => {
    expect(evaluateCostControl(control(), 99).allowed).toBe(true); // 99 + 1 = 100
  });

  it('blocks over the cap in block mode', () => {
    const d = evaluateCostControl(control({ enforcement: 'block' }), 100);
    expect(d).toMatchObject({ allowed: false, overCap: true, enforcement: 'block' });
  });

  it('allows-but-flags over the cap in warn mode', () => {
    const d = evaluateCostControl(control({ enforcement: 'warn' }), 100);
    expect(d).toMatchObject({ allowed: true, overCap: true, enforcement: 'warn' });
  });
});

describe('in-memory cost-control store', () => {
  it('round-trips get/upsert', async () => {
    const store = createInMemoryCostControlStore([control()]);
    expect(await store.get('acme')).toMatchObject({ maxRelaySessionsPerPeriod: 100 });
    expect(await store.get('nobody')).toBeNull();
    await store.upsert(control({ maxRelaySessionsPerPeriod: 5, enforcement: 'warn' }));
    expect(await store.get('acme')).toMatchObject({
      maxRelaySessionsPerPeriod: 5,
      enforcement: 'warn',
    });
  });
});

// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createInMemoryUsageAlertStore } from '../src/usage-alerts';

describe('createInMemoryUsageAlertStore', () => {
  it('claims a slot once, then reports already-claimed', async () => {
    const store = createInMemoryUsageAlertStore();
    const slot = {
      organizationId: 'acme',
      periodStart: '2026-06-01',
      severity: 'blocked' as const,
    };
    expect(await store.claim(slot)).toBe(true);
    expect(await store.claim(slot)).toBe(false);
    expect(await store.claim(slot)).toBe(false);
  });

  it('keys independently by severity and period', async () => {
    const store = createInMemoryUsageAlertStore();
    const base = { organizationId: 'acme', periodStart: '2026-06-01' };
    expect(await store.claim({ ...base, severity: 'warning' })).toBe(true);
    expect(await store.claim({ ...base, severity: 'blocked' })).toBe(true); // distinct severity
    expect(await store.claim({ ...base, periodStart: '2026-07-01', severity: 'warning' })).toBe(
      true, // distinct period
    );
    expect(await store.claim({ ...base, severity: 'warning' })).toBe(false); // same slot again
  });
});

// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createInMemoryMeterSink, USAGE_KINDS } from '../src/metering';

describe('in-memory meter sink', () => {
  it('sums recorded usage by kind for an organization', async () => {
    const meter = createInMemoryMeterSink();
    await meter.record({
      occurredAt: '2026-05-01T00:00:00Z',
      organizationId: 'acme',
      kind: USAGE_KINDS.relaySession,
      quantity: 1,
    });
    await meter.record({
      occurredAt: '2026-05-02T00:00:00Z',
      organizationId: 'acme',
      kind: USAGE_KINDS.relaySession,
      quantity: 2,
    });
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({ 'relay.session': 3 });
  });

  it('scopes the summary to the organization', async () => {
    const meter = createInMemoryMeterSink();
    await meter.record({
      occurredAt: '2026-05-01T00:00:00Z',
      organizationId: 'acme',
      kind: 'relay.session',
      quantity: 5,
    });
    await meter.record({
      occurredAt: '2026-05-01T00:00:00Z',
      organizationId: 'other',
      kind: 'relay.session',
      quantity: 9,
    });
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({ 'relay.session': 5 });
  });

  it('honours the `since` window', async () => {
    const meter = createInMemoryMeterSink();
    await meter.record({
      occurredAt: '2026-04-30T00:00:00Z',
      organizationId: 'acme',
      kind: 'relay.session',
      quantity: 4,
    });
    await meter.record({
      occurredAt: '2026-05-05T00:00:00Z',
      organizationId: 'acme',
      kind: 'relay.session',
      quantity: 1,
    });
    expect(
      await meter.summarize({ organizationId: 'acme', since: '2026-05-01T00:00:00Z' }),
    ).toEqual({
      'relay.session': 1,
    });
  });

  it('honours the half-open `[since, until)` window', async () => {
    const meter = createInMemoryMeterSink();
    for (const [occurredAt, quantity] of [
      ['2026-03-31T00:00:00Z', 2], // before the window
      ['2026-04-10T00:00:00Z', 3], // inside
      ['2026-05-01T00:00:00Z', 4], // at `until` → excluded (exclusive)
      ['2026-05-09T00:00:00Z', 5], // after
    ] as const) {
      await meter.record({ occurredAt, organizationId: 'acme', kind: 'relay.session', quantity });
    }
    expect(
      await meter.summarize({
        organizationId: 'acme',
        since: '2026-04-01T00:00:00Z',
        until: '2026-05-01T00:00:00Z',
      }),
    ).toEqual({ 'relay.session': 3 });
  });
});

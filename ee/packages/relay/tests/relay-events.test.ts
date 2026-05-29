// SPDX-License-Identifier: Elastic-2.0

import { MAX_RELAY_EVENT_BATCH, parseRelayEventBatch } from '@pinagent/ee-relay';
import { describe, expect, it } from 'vitest';

const valid = {
  type: 'client.connected',
  organizationId: 'acme',
  sessionId: 'sess-1',
  occurredAt: '2026-05-29T00:00:00Z',
  userId: 'user-1',
};

describe('parseRelayEventBatch', () => {
  it('parses a well-formed batch', () => {
    const events = parseRelayEventBatch({
      events: [valid, { ...valid, type: 'device.connected', userId: undefined }],
    });
    expect(events).not.toBeNull();
    expect(events).toHaveLength(2);
    expect(events?.[0]).toEqual(valid);
    // userId omitted (not set to undefined) on the device event.
    expect(events?.[1]).not.toHaveProperty('userId');
  });

  it('rejects unknown event types', () => {
    expect(parseRelayEventBatch({ events: [{ ...valid, type: 'session.exploded' }] })).toBeNull();
  });

  it('rejects missing required fields', () => {
    expect(parseRelayEventBatch({ events: [{ ...valid, sessionId: '' }] })).toBeNull();
    expect(parseRelayEventBatch({ events: [{ ...valid, organizationId: undefined }] })).toBeNull();
  });

  it('rejects a non-array / missing events', () => {
    expect(parseRelayEventBatch({})).toBeNull();
    expect(parseRelayEventBatch({ events: 'nope' })).toBeNull();
    expect(parseRelayEventBatch(null)).toBeNull();
  });

  it('rejects an oversized batch', () => {
    const events = Array.from({ length: MAX_RELAY_EVENT_BATCH + 1 }, () => valid);
    expect(parseRelayEventBatch({ events })).toBeNull();
  });
});

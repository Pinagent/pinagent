// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { type AuditEvent, createInMemoryAuditSink } from '../src/audit';

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    occurredAt: '2026-05-01T00:00:00.000Z',
    organizationId: 'acme',
    actorUserId: 'user-1',
    action: 'relay.session.issued',
    ...overrides,
  };
}

describe('in-memory audit sink', () => {
  it('records and lists events for an organization', async () => {
    const sink = createInMemoryAuditSink();
    await sink.record(event());
    const rows = await sink.list({ organizationId: 'acme' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'relay.session.issued', actorUserId: 'user-1' });
  });

  it('scopes list() to the queried organization', async () => {
    const sink = createInMemoryAuditSink();
    await sink.record(event({ organizationId: 'acme' }));
    await sink.record(event({ organizationId: 'other' }));
    expect(await sink.list({ organizationId: 'acme' })).toHaveLength(1);
  });

  it('returns events newest-first and respects the limit', async () => {
    const sink = createInMemoryAuditSink();
    await sink.record(event({ occurredAt: '2026-05-01T00:00:00.000Z', targetId: 'a' }));
    await sink.record(event({ occurredAt: '2026-05-03T00:00:00.000Z', targetId: 'c' }));
    await sink.record(event({ occurredAt: '2026-05-02T00:00:00.000Z', targetId: 'b' }));

    const rows = await sink.list({ organizationId: 'acme', limit: 2 });
    expect(rows.map((r) => r.targetId)).toEqual(['c', 'b']);
  });
});

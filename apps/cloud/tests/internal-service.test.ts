// SPDX-License-Identifier: Elastic-2.0
import { createInMemoryMeterSink, USAGE_KINDS } from '@pinagent/ee-billing';
import { createInMemoryActiveSessionRegistry } from '@pinagent/ee-relay';
import { createInMemoryAuditSink } from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import { handleRelayEvents } from '../src/internal-service';

const SECRET = 'relay-internal-secret';

function post(body: unknown, auth?: string): Request {
  return new Request('https://cloud.test/internal/relay/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const batch = {
  events: [
    {
      type: 'client.connected',
      organizationId: 'acme',
      sessionId: 'sess-1',
      occurredAt: '2026-05-29T00:00:00Z',
      userId: 'user-1',
    },
    {
      type: 'device.disconnected',
      organizationId: 'acme',
      sessionId: 'sess-1',
      occurredAt: '2026-05-29T00:01:00Z',
    },
  ],
};

describe('POST /internal/relay/events', () => {
  it('records events to audit with the right secret', async () => {
    const audit = createInMemoryAuditSink();
    const res = await handleRelayEvents(post(batch, `Bearer ${SECRET}`), {
      audit,
      relayInternalSecret: SECRET,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 2 });
    expect(audit.events).toEqual([
      {
        occurredAt: '2026-05-29T00:00:00Z',
        organizationId: 'acme',
        actorUserId: 'user-1',
        action: 'relay.client.connected',
        targetId: 'sess-1',
      },
      {
        occurredAt: '2026-05-29T00:01:00Z',
        organizationId: 'acme',
        actorUserId: null, // device event has no user
        action: 'relay.device.disconnected',
        targetId: 'sess-1',
      },
    ]);
  });

  it('401s with a wrong or missing secret', async () => {
    const deps = { audit: createInMemoryAuditSink(), relayInternalSecret: SECRET };
    expect((await handleRelayEvents(post(batch, 'Bearer wrong'), deps)).status).toBe(401);
    expect((await handleRelayEvents(post(batch), deps)).status).toBe(401);
  });

  it('400s on malformed JSON or an invalid batch', async () => {
    const deps = { audit: createInMemoryAuditSink(), relayInternalSecret: SECRET };
    expect((await handleRelayEvents(post('not json', `Bearer ${SECRET}`), deps)).status).toBe(400);
    expect(
      (await handleRelayEvents(post({ events: [{ type: 'bogus' }] }, `Bearer ${SECRET}`), deps))
        .status,
    ).toBe(400);
  });

  it('405s on a non-POST method', async () => {
    const req = new Request('https://cloud.test/internal/relay/events', {
      method: 'GET',
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(
      (
        await handleRelayEvents(req, {
          audit: createInMemoryAuditSink(),
          relayInternalSecret: SECRET,
        })
      ).status,
    ).toBe(405);
  });

  it('meters connection seconds from a device disconnect duration', async () => {
    const audit = createInMemoryAuditSink();
    const meter = createInMemoryMeterSink();
    const events = {
      events: [
        {
          type: 'device.connected',
          organizationId: 'acme',
          sessionId: 'sess-1',
          occurredAt: '2026-05-29T00:00:00Z',
        },
        {
          type: 'device.disconnected',
          organizationId: 'acme',
          sessionId: 'sess-1',
          occurredAt: '2026-05-29T00:02:30Z',
          durationMs: 150_000, // 2.5 min → 150 s
        },
      ],
    };
    const res = await handleRelayEvents(post(events, `Bearer ${SECRET}`), {
      audit,
      meter,
      relayInternalSecret: SECRET,
    });
    expect(res.status).toBe(200);
    // Only the device disconnect (with durationMs) meters; the connect does not.
    expect(meter.events).toEqual([
      {
        occurredAt: '2026-05-29T00:02:30Z',
        organizationId: 'acme',
        kind: USAGE_KINDS.relayConnectionSeconds,
        quantity: 150,
        metadata: { sessionId: 'sess-1', side: 'device' },
      },
    ]);
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({
      'relay.connection.seconds': 150,
    });
  });

  it('does not double-count: client disconnects carry a duration but never meter', async () => {
    const audit = createInMemoryAuditSink();
    const meter = createInMemoryMeterSink();
    // A device + a client both disconnect with a duration. Only the device's
    // counts — metering the client too would roughly double the session's time.
    const events = {
      events: [
        {
          type: 'device.disconnected',
          organizationId: 'acme',
          sessionId: 'sess-1',
          occurredAt: '2026-05-29T00:02:30Z',
          durationMs: 150_000,
        },
        {
          type: 'client.disconnected',
          organizationId: 'acme',
          sessionId: 'sess-1',
          occurredAt: '2026-05-29T00:02:30Z',
          durationMs: 140_000,
        },
      ],
    };
    const res = await handleRelayEvents(post(events, `Bearer ${SECRET}`), {
      audit,
      meter,
      relayInternalSecret: SECRET,
    });
    expect(res.status).toBe(200);
    expect(meter.events).toHaveLength(1);
    expect(meter.events[0]?.metadata).toEqual({ sessionId: 'sess-1', side: 'device' });
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({
      'relay.connection.seconds': 150,
    });
  });

  it('records audit without metering when no meter is configured', async () => {
    const audit = createInMemoryAuditSink();
    const res = await handleRelayEvents(post(batch, `Bearer ${SECRET}`), {
      audit,
      relayInternalSecret: SECRET,
    });
    expect(res.status).toBe(200); // no meter dep → audit only, no throw
  });

  it('tracks live device sessions in the registry (connect adds, disconnect removes)', async () => {
    const activeSessions = createInMemoryActiveSessionRegistry();
    const events = {
      events: [
        {
          type: 'device.connected',
          organizationId: 'acme',
          sessionId: 'dev-1',
          occurredAt: '2026-05-29T00:00:00Z',
        },
        {
          type: 'device.connected',
          organizationId: 'acme',
          sessionId: 'dev-2',
          occurredAt: '2026-05-29T00:00:05Z',
        },
        // a browser session — must NOT land in the device registry
        {
          type: 'client.connected',
          organizationId: 'acme',
          sessionId: 'browser-1',
          occurredAt: '2026-05-29T00:00:06Z',
          userId: 'u1',
        },
        {
          type: 'device.disconnected',
          organizationId: 'acme',
          sessionId: 'dev-1',
          occurredAt: '2026-05-29T00:01:00Z',
          durationMs: 60_000,
        },
      ],
    };
    const res = await handleRelayEvents(post(events, `Bearer ${SECRET}`), {
      audit: createInMemoryAuditSink(),
      activeSessions,
      relayInternalSecret: SECRET,
    });
    expect(res.status).toBe(200);
    const live = await activeSessions.listByOrg('acme');
    expect(live.map((s) => s.sessionId)).toEqual(['dev-2']);
    expect(live[0]?.connectedAt).toBe('2026-05-29T00:00:05Z');
  });
});

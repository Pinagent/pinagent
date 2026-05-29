// SPDX-License-Identifier: Elastic-2.0
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
});

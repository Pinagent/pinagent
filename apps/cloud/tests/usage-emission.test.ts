// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership, Role } from '@pinagent/ee-auth';
import { createInMemoryMeterSink, USAGE_KINDS } from '@pinagent/ee-billing';
import { describe, expect, it } from 'vitest';
import { handleSessionRequest } from '../src/session-service';

const NOW = 1_000_000;
const NOW_ISO = new Date(NOW * 1000).toISOString();

function member(role: Role): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId: 'user-1',
    role,
    status: 'active',
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt: '2026-01-02T00:00:00Z',
  };
}

function storeWith(m: OrganizationMembership | null): MembershipStore {
  return {
    async getMembership(org, user) {
      return m && m.organizationId === org && m.userId === user ? m : null;
    },
    async getOrganization() {
      return null;
    },
    async listMembers() {
      return m ? [m] : [];
    },
    async upsertMembership() {},
    async removeMembership() {},
  };
}

function sessionRequest(): Request {
  return new Request('https://cloud.test/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId: 'acme', sessionId: 'sess-1' }),
  });
}

describe('usage emission — session issuance', () => {
  it('records one relay.session unit on success', async () => {
    const meter = createInMemoryMeterSink();
    const res = await handleSessionRequest(sessionRequest(), {
      store: storeWith(member('member')),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: 'relay-secret',
      relayUrl: 'wss://relay.test',
      meter,
      nowSeconds: NOW,
    });
    expect(res.status).toBe(200);
    expect(meter.events).toEqual([
      {
        occurredAt: NOW_ISO,
        organizationId: 'acme',
        kind: USAGE_KINDS.relaySession,
        quantity: 1,
        metadata: { sessionId: 'sess-1', role: 'member' },
      },
    ]);
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({ 'relay.session': 1 });
  });

  it('does not meter a denied session', async () => {
    const meter = createInMemoryMeterSink();
    const res = await handleSessionRequest(sessionRequest(), {
      store: storeWith(null),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: 'relay-secret',
      relayUrl: 'wss://relay.test',
      meter,
      nowSeconds: NOW,
    });
    expect(res.status).toBe(403);
    expect(meter.events).toHaveLength(0);
  });

  it('works without a meter (optional dep)', async () => {
    const res = await handleSessionRequest(sessionRequest(), {
      store: storeWith(member('member')),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: 'relay-secret',
      relayUrl: 'wss://relay.test',
    });
    expect(res.status).toBe(200);
  });
});

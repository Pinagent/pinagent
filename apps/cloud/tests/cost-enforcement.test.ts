// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership } from '@pinagent/ee-auth';
import { createInMemoryMeterSink, type MeterSink, USAGE_KINDS } from '@pinagent/ee-billing';
import {
  type CostControl,
  createInMemoryAuditSink,
  createInMemoryCostControlStore,
} from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import { handleSessionRequest, type SessionServiceDeps } from '../src/session-service';

const membership: OrganizationMembership = {
  organizationId: 'acme',
  userId: 'user-1',
  role: 'member',
  status: 'active',
  invitedAt: '2026-01-01T00:00:00Z',
  joinedAt: '2026-01-02T00:00:00Z',
};

const store: MembershipStore = {
  async getMembership(org, user) {
    return org === 'acme' && user === 'user-1' ? membership : null;
  },
  async getOrganization() {
    return null;
  },
  async listMembers() {
    return [membership];
  },
  async listMembershipsByUser() {
    return [];
  },
  async upsertMembership() {},
  async removeMembership() {},
};

function request(): Request {
  return new Request('https://cloud.test/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId: 'acme', sessionId: 'sess-1' }),
  });
}

async function meterWith(
  used: number,
): Promise<MeterSink & { readonly events: readonly unknown[] }> {
  const meter = createInMemoryMeterSink();
  for (let i = 0; i < used; i++) {
    await meter.record({
      occurredAt: '2026-05-10T00:00:00Z',
      organizationId: 'acme',
      kind: USAGE_KINDS.relaySession,
      quantity: 1,
    });
  }
  return meter;
}

function deps(extra: Partial<SessionServiceDeps>): SessionServiceDeps {
  return {
    store,
    authenticate: async () => ({ userId: 'user-1' }),
    secret: 'relay-secret',
    relayUrl: 'wss://relay.test',
    nowSeconds: 1_000_000,
    ...extra,
  };
}

const cap = (overrides: Partial<CostControl> = {}): CostControl => ({
  organizationId: 'acme',
  maxRelaySessionsPerPeriod: 10,
  enforcement: 'block',
  ...overrides,
});

describe('cost-control enforcement at session issuance', () => {
  it('issues when under the cap', async () => {
    const meter = await meterWith(5);
    const costControls = createInMemoryCostControlStore([cap()]);
    const res = await handleSessionRequest(request(), deps({ meter, costControls }));
    expect(res.status).toBe(200);
  });

  it('blocks (402) over the cap in block mode, without metering', async () => {
    const meter = await meterWith(10); // at cap; +1 over
    const audit = createInMemoryAuditSink();
    const before = meter.events.length;
    const res = await handleSessionRequest(
      request(),
      deps({
        meter,
        audit,
        costControls: createInMemoryCostControlStore([cap({ enforcement: 'block' })]),
      }),
    );
    expect(res.status).toBe(402);
    expect(meter.events.length).toBe(before); // not metered
    expect(audit.events.at(-1)).toMatchObject({
      action: 'cost.cap.blocked',
      metadata: { cap: 10, used: 10 },
    });
  });

  it('allows but warns over the cap in warn mode, and still meters', async () => {
    const meter = await meterWith(10);
    const audit = createInMemoryAuditSink();
    const before = meter.events.length;
    const res = await handleSessionRequest(
      request(),
      deps({
        meter,
        audit,
        costControls: createInMemoryCostControlStore([cap({ enforcement: 'warn' })]),
      }),
    );
    expect(res.status).toBe(200);
    expect(meter.events.length).toBe(before + 1); // metered
    expect(audit.events.some((e) => e.action === 'cost.cap.warning')).toBe(true);
  });

  it('does nothing without a cost-control store', async () => {
    const meter = await meterWith(100);
    const res = await handleSessionRequest(request(), deps({ meter }));
    expect(res.status).toBe(200);
  });
});

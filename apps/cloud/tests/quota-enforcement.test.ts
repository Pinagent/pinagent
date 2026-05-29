// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership } from '@pinagent/ee-auth';
import {
  createInMemoryMeterSink,
  createInMemorySubscriptionStore,
  type MeterSink,
  type SubscriptionStore,
  USAGE_KINDS,
} from '@pinagent/ee-billing';
import { createInMemoryAuditSink } from '@pinagent/ee-team-features';
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

function baseDeps(overrides: Partial<SessionServiceDeps>): SessionServiceDeps {
  return {
    store,
    authenticate: async () => ({ userId: 'user-1' }),
    secret: 'relay-secret',
    relayUrl: 'wss://relay.test',
    nowSeconds: 1_000_000,
    ...overrides,
  };
}

/** Free plan (limit 100) with `usedSoFar` sessions already this period. */
async function freePlanWithUsage(usedSoFar: number): Promise<{
  subscriptions: SubscriptionStore;
  meter: MeterSink & { readonly events: readonly unknown[] };
}> {
  const subscriptions = createInMemorySubscriptionStore([
    { organizationId: 'acme', planId: 'free', currentPeriodStart: '2026-05-01T00:00:00Z' },
  ]);
  const meter = createInMemoryMeterSink();
  for (let i = 0; i < usedSoFar; i++) {
    await meter.record({
      occurredAt: '2026-05-10T00:00:00Z',
      organizationId: 'acme',
      kind: USAGE_KINDS.relaySession,
      quantity: 1,
    });
  }
  return { subscriptions, meter };
}

describe('quota enforcement at session issuance', () => {
  it('issues and meters when under the plan limit', async () => {
    const { subscriptions, meter } = await freePlanWithUsage(50);
    const before = meter.events.length;
    const res = await handleSessionRequest(request(), baseDeps({ subscriptions, meter }));
    expect(res.status).toBe(200);
    expect(meter.events.length).toBe(before + 1); // the new session metered
  });

  it('returns 402 and does not meter when over the plan limit', async () => {
    const { subscriptions, meter } = await freePlanWithUsage(100); // at the cap
    const audit = createInMemoryAuditSink();
    const before = meter.events.length;
    const res = await handleSessionRequest(request(), baseDeps({ subscriptions, meter, audit }));
    expect(res.status).toBe(402);
    expect(meter.events.length).toBe(before); // not metered
    expect(audit.events[0]).toMatchObject({
      action: 'relay.session.denied',
      metadata: { reason: 'quota', plan: 'free', limit: 100 },
    });
  });

  it('does not enforce without a subscription store (meter only)', async () => {
    const { meter } = await freePlanWithUsage(100);
    const res = await handleSessionRequest(request(), baseDeps({ meter })); // no subscriptions
    expect(res.status).toBe(200);
  });
});

// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership } from '@pinagent/ee-auth';
import {
  createInMemoryIssuanceLock,
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

/** A POST with a distinct sessionId so concurrent requests are realistic. */
function requestFor(sessionId: string): Request {
  return new Request('https://cloud.test/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId: 'acme', sessionId }),
  });
}

/**
 * Wrap a meter so the first `parties` concurrent `summarize` calls all block
 * until everyone has arrived, then read together. This deterministically forces
 * the TOCTOU window an unserialized quota gate suffers from — every racer reads
 * the same stale total before any of them records — without relying on fragile
 * microtask lockstep. (Don't use this under a lock: the lock lets only one racer
 * in, so the barrier would never reach `parties` and would deadlock.)
 */
function barrierMeter(base: MeterSink & { readonly events: readonly unknown[] }, parties: number) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    get events() {
      return base.events;
    },
    async record(event: Parameters<MeterSink['record']>[0]) {
      return base.record(event);
    },
    async summarize(query: Parameters<MeterSink['summarize']>[0]) {
      arrived++;
      if (arrived >= parties) open();
      await gate; // read only after every racer has arrived
      return base.summarize(query);
    },
  };
}

/**
 * Wrap a meter to track the peak number of overlapping `summarize` calls. Under
 * an issuance lock the quota gate runs one-at-a-time, so this stays 1 — the
 * observable proof that the critical section is serialized.
 */
function overlapTrackingMeter(base: MeterSink & { readonly events: readonly unknown[] }) {
  let inFlight = 0;
  let maxOverlap = 0;
  return {
    get events() {
      return base.events;
    },
    get maxOverlap() {
      return maxOverlap;
    },
    async record(event: Parameters<MeterSink['record']>[0]) {
      return base.record(event);
    },
    async summarize(query: Parameters<MeterSink['summarize']>[0]) {
      inFlight++;
      maxOverlap = Math.max(maxOverlap, inFlight);
      try {
        return await base.summarize(query);
      } finally {
        inFlight--;
      }
    },
  };
}

describe('concurrent issuance and the quota race', () => {
  // A clock inside the billing period (after currentPeriodStart 2026-05-01) so
  // newly-metered events fall within the window `checkQuota` counts. (The
  // suite-wide default of epoch 1_000_000 lands in 1970, before the period —
  // fine for single-request tests, but the race needs new records to count.)
  const NOW_IN_PERIOD = 1_779_926_400; // 2026-05-28T00:00:00Z

  // 99 used against the free limit of 100 → exactly one slot left.
  it('overshoots the cap without an issuance lock (the race)', async () => {
    const { subscriptions, meter: base } = await freePlanWithUsage(99);
    const meter = barrierMeter(base, 3);
    const deps = baseDeps({ subscriptions, meter, nowSeconds: NOW_IN_PERIOD });
    const results = await Promise.all([
      handleSessionRequest(requestFor('s1'), deps),
      handleSessionRequest(requestFor('s2'), deps),
      handleSessionRequest(requestFor('s3'), deps),
    ]);
    const ok = results.filter((r) => r.status === 200).length;
    // Unserialized: all three quota reads see used=99, all pass and meter → over
    // the cap.
    expect(ok).toBe(3);
    expect(meter.events.length).toBe(102); // 99 + 3, past the limit of 100
  });

  it('holds the cap under an issuance lock — exactly one of the racers wins', async () => {
    const { subscriptions, meter: base } = await freePlanWithUsage(99);
    const meter = overlapTrackingMeter(base);
    const deps = baseDeps({
      subscriptions,
      meter,
      issuanceLock: createInMemoryIssuanceLock(),
      nowSeconds: NOW_IN_PERIOD,
    });
    const results = await Promise.all([
      handleSessionRequest(requestFor('s1'), deps),
      handleSessionRequest(requestFor('s2'), deps),
      handleSessionRequest(requestFor('s3'), deps),
    ]);
    const ok = results.filter((r) => r.status === 200).length;
    const denied = results.filter((r) => r.status === 402).length;
    expect(meter.maxOverlap).toBe(1); // the gate ran one-at-a-time
    expect(ok).toBe(1); // only the single remaining slot is granted
    expect(denied).toBe(2);
    expect(meter.events.length).toBe(100); // metered exactly up to the cap
  });

  it('serializes per org without blocking a different org', async () => {
    // org-a is at its cap; org-b has room. A lock on org-a must not stall org-b.
    const subscriptions = createInMemorySubscriptionStore([
      { organizationId: 'acme', planId: 'free', currentPeriodStart: '2026-05-01T00:00:00Z' },
      { organizationId: 'other', planId: 'free', currentPeriodStart: '2026-05-01T00:00:00Z' },
    ]);
    const meter = createInMemoryMeterSink();
    const issuanceLock = createInMemoryIssuanceLock();
    const otherStore: MembershipStore = {
      async getMembership(org, user) {
        return user === 'user-1' && (org === 'acme' || org === 'other')
          ? { ...membership, organizationId: org }
          : null;
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
    const deps = baseDeps({
      store: otherStore,
      subscriptions,
      meter,
      issuanceLock,
      nowSeconds: NOW_IN_PERIOD,
    });
    const acme = new Request('https://cloud.test/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'acme', sessionId: 'a1' }),
    });
    const other = new Request('https://cloud.test/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'other', sessionId: 'b1' }),
    });
    const [ra, rb] = await Promise.all([
      handleSessionRequest(acme, deps),
      handleSessionRequest(other, deps),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
  });
});

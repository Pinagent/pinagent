// SPDX-License-Identifier: Elastic-2.0
import {
  createInMemoryUserStore,
  type MembershipStore,
  type OrganizationMembership,
  type Role,
} from '@pinagent/ee-auth';
import {
  createInMemoryMeterSink,
  createInMemoryUsageAlertStore,
  USAGE_KINDS,
} from '@pinagent/ee-billing';
import { createInMemoryCostControlStore } from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import { handleSessionRequest, type SessionServiceDeps } from '../src/session-service';

const SECRET = 'test-secret';
const RELAY_URL = 'wss://relay.test';

function member(userId: string, role: Role): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId,
    role,
    status: 'active',
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt: '2026-01-02T00:00:00Z',
  };
}

/** Caller (member) + two admins/owners + a viewer; getOrganization names the org. */
function teamStore(): MembershipStore {
  const members = [
    member('user-1', 'member'), // the caller
    member('u-admin', 'admin'),
    member('u-owner', 'owner'),
    member('u-viewer', 'viewer'),
  ];
  return {
    async getMembership(org, user) {
      return members.find((m) => m.userId === user && m.organizationId === org) ?? null;
    },
    async getOrganization(id) {
      return { id, slug: 'acme', displayName: 'Acme Inc', createdAt: '2026-01-01T00:00:00Z' };
    },
    async listMembers() {
      return members;
    },
    async listMembershipsByUser() {
      return [];
    },
    async upsertMembership() {},
    async removeMembership() {},
  };
}

type Alert = {
  to: string;
  organizationName: string;
  used: number;
  limit: number | null;
  severity: string;
};

function recordingEmail(impl?: () => Promise<void>): {
  email: NonNullable<SessionServiceDeps['email']>;
  sent: Alert[];
} {
  const sent: Alert[] = [];
  return {
    sent,
    email: {
      async sendUsageAlert(input) {
        sent.push(input);
        if (impl) await impl();
      },
    },
  };
}

/**
 * Build deps with cost-cap alerting wired. `enforcement` + `usedUnits` (seeded
 * into the meter) decide whether issuance is blocked (over a `block` cap) or
 * warned. Admins u-admin/u-owner have addresses; the viewer doesn't.
 */
async function alertDeps(
  enforcement: 'block' | 'warn',
  over: boolean,
  extra: Partial<SessionServiceDeps> = {},
) {
  const meter = createInMemoryMeterSink();
  if (over) {
    await meter.record({
      occurredAt: '2026-06-01T00:00:00Z',
      organizationId: 'acme',
      kind: USAGE_KINDS.relaySession,
      quantity: 1,
    });
  }
  // `sent` tracks the default recorder; tests overriding `email` (e.g. a
  // throwing mailer) don't assert on it.
  const rec = recordingEmail();
  const deps: SessionServiceDeps = {
    store: teamStore(),
    authenticate: async () => ({ userId: 'user-1' }),
    secret: SECRET,
    relayUrl: RELAY_URL,
    meter,
    costControls: createInMemoryCostControlStore([
      { organizationId: 'acme', maxRelaySessionsPerPeriod: 1, enforcement },
    ]),
    users: createInMemoryUserStore([
      { id: 'u-admin', email: 'admin@acme.com', displayName: 'A', createdAt: '', lastLoginAt: '' },
      { id: 'u-owner', email: 'owner@acme.com', displayName: 'O', createdAt: '', lastLoginAt: '' },
    ]),
    usageAlerts: createInMemoryUsageAlertStore(),
    email: rec.email,
    ...extra,
  };
  return { deps, sent: rec.sent };
}

function postSessions() {
  return new Request('https://cloud.test/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId: 'acme', sessionId: 's-1' }),
  });
}

describe('usage-cap alert on session issuance', () => {
  it('emails admins+owners (only) when a block cap is hit; issuance is 402', async () => {
    const { deps, sent } = await alertDeps('block', true);
    const res = await handleSessionRequest(postSessions(), deps); // no waitUntil → awaited inline
    expect(res.status).toBe(402);
    expect(sent.map((a) => a.to).sort()).toEqual(['admin@acme.com', 'owner@acme.com']);
    expect(sent[0]).toMatchObject({ organizationName: 'Acme Inc', limit: 1, severity: 'blocked' });
  });

  it('emails a warning when a warn cap is exceeded; issuance still succeeds (200)', async () => {
    const { deps, sent } = await alertDeps('warn', true);
    const res = await handleSessionRequest(postSessions(), deps);
    expect(res.status).toBe(200);
    expect(sent.map((a) => a.to).sort()).toEqual(['admin@acme.com', 'owner@acme.com']);
    expect(sent[0]?.severity).toBe('warning');
  });

  it('throttles: a second over-cap issuance does not re-email', async () => {
    const { deps, sent } = await alertDeps('block', true);
    await handleSessionRequest(postSessions(), deps);
    await handleSessionRequest(postSessions(), deps);
    expect(sent).toHaveLength(2); // 2 admins, once — not 4
  });

  it('does not alert when under the cap', async () => {
    const { deps, sent } = await alertDeps('block', false);
    const res = await handleSessionRequest(postSessions(), deps);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('fires the send via waitUntil (off the issuance lock / response path)', async () => {
    const { deps, sent } = await alertDeps('block', true);
    const tasks: Promise<unknown>[] = [];
    await handleSessionRequest(postSessions(), deps, (p) => tasks.push(p));
    // The alert was handed to waitUntil rather than awaited in the handler.
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(sent.map((a) => a.to).sort()).toEqual(['admin@acme.com', 'owner@acme.com']);
  });

  it('is best-effort: a throwing mailer never affects issuance', async () => {
    const rec = recordingEmail(async () => {
      throw new Error('resend down');
    });
    const { deps } = await alertDeps('block', true, { email: rec.email });
    const res = await handleSessionRequest(postSessions(), deps);
    expect(res.status).toBe(402); // still the cost-cap denial, no throw
  });

  it('no-ops when the alert deps are not all wired (no usageAlerts)', async () => {
    const { deps, sent } = await alertDeps('block', true, { usageAlerts: undefined });
    const res = await handleSessionRequest(postSessions(), deps);
    expect(res.status).toBe(402);
    expect(sent).toHaveLength(0);
  });
});

// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership, Role } from '@pinagent/ee-auth';
import { createInMemoryMeterSink, USAGE_KINDS } from '@pinagent/ee-billing';
import { AUDIT_ACTIONS, createInMemoryAuditSink } from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import {
  handleAudit,
  handleMembers,
  handleMyOrgs,
  handleUsage,
  type ReadServiceDeps,
} from '../src/read-service';

function membership(userId: string, role: Role): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId,
    role,
    status: 'active',
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt: '2026-01-02T00:00:00Z',
  };
}

/** Store with an admin (`u-admin`), a viewer (`u-viewer`), in org `acme`. */
function store(): MembershipStore {
  const members = [membership('u-admin', 'admin'), membership('u-viewer', 'viewer')];
  return {
    async getMembership(org, user) {
      return org === 'acme' ? (members.find((m) => m.userId === user) ?? null) : null;
    },
    async getOrganization(id) {
      return id === 'acme'
        ? { id: 'acme', slug: 'acme', displayName: 'Acme', createdAt: '2026-01-01T00:00:00Z' }
        : null;
    },
    async listMembers(org) {
      return org === 'acme' ? members : [];
    },
    async listMembershipsByUser(user) {
      return members.filter((m) => m.userId === user);
    },
    async upsertMembership() {},
    async removeMembership() {},
  };
}

async function deps(asUserId: string | null): Promise<ReadServiceDeps> {
  const meter = createInMemoryMeterSink();
  await meter.record({
    occurredAt: '2026-05-10T00:00:00Z',
    organizationId: 'acme',
    kind: USAGE_KINDS.relaySession,
    quantity: 3,
  });
  const audit = createInMemoryAuditSink();
  await audit.record({
    occurredAt: '2026-05-10T00:00:00Z',
    organizationId: 'acme',
    actorUserId: 'u-admin',
    action: AUDIT_ACTIONS.sessionIssued,
  });
  return {
    store: store(),
    authenticate: async () => (asUserId ? { userId: asUserId } : null),
    audit,
    meter,
  };
}

function get(path: string): Request {
  return new Request(`https://cloud.test${path}`, { method: 'GET' });
}

describe('GET /usage', () => {
  it('returns the usage summary for a member with billing:read', async () => {
    const res = await handleUsage(get('/usage?organizationId=acme'), await deps('u-viewer'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizationId: 'acme', usage: { 'relay.session': 3 } });
  });

  it('401s when unauthenticated', async () => {
    const res = await handleUsage(get('/usage?organizationId=acme'), await deps(null));
    expect(res.status).toBe(401);
  });

  it('400s without organizationId', async () => {
    const res = await handleUsage(get('/usage'), await deps('u-viewer'));
    expect(res.status).toBe(400);
  });

  it('403s for a non-member', async () => {
    const res = await handleUsage(get('/usage?organizationId=acme'), await deps('outsider'));
    expect(res.status).toBe(403);
  });
});

describe('GET /audit', () => {
  it('returns audit events for an admin', async () => {
    const res = await handleAudit(get('/audit?organizationId=acme'), await deps('u-admin'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('403s for a viewer (org:settings required)', async () => {
    const res = await handleAudit(get('/audit?organizationId=acme'), await deps('u-viewer'));
    expect(res.status).toBe(403);
  });
});

describe('GET /members', () => {
  it('lists members for an admin', async () => {
    const res = await handleMembers(get('/members?organizationId=acme'), await deps('u-admin'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: unknown[] };
    expect(body.members).toHaveLength(2);
  });

  it('403s for a viewer', async () => {
    const res = await handleMembers(get('/members?organizationId=acme'), await deps('u-viewer'));
    expect(res.status).toBe(403);
  });

  it('405s on a non-GET method', async () => {
    const req = new Request('https://cloud.test/members?organizationId=acme', { method: 'POST' });
    expect((await handleMembers(req, await deps('u-admin'))).status).toBe(405);
  });
});

describe('GET /me/orgs', () => {
  it("returns the caller's enriched memberships (no org param, no RBAC)", async () => {
    const res = await handleMyOrgs(get('/me/orgs'), await deps('u-viewer'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgs: [
        {
          organizationId: 'acme',
          displayName: 'Acme',
          slug: 'acme',
          role: 'viewer',
          status: 'active',
        },
      ],
    });
  });

  it('returns an empty list for a user with no memberships', async () => {
    const res = await handleMyOrgs(get('/me/orgs'), await deps('outsider'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgs: [] });
  });

  it('401s when unauthenticated', async () => {
    expect((await handleMyOrgs(get('/me/orgs'), await deps(null))).status).toBe(401);
  });

  it('405s on a non-GET method', async () => {
    const req = new Request('https://cloud.test/me/orgs', { method: 'POST' });
    expect((await handleMyOrgs(req, await deps('u-admin'))).status).toBe(405);
  });
});

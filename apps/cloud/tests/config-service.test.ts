// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership, Role } from '@pinagent/ee-auth';
import { createInMemorySubscriptionStore } from '@pinagent/ee-billing';
import { type ActiveSession, createInMemoryActiveSessionRegistry } from '@pinagent/ee-relay';
import {
  createInMemoryBranchRoutingStore,
  createInMemoryCostControlStore,
} from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import {
  type ConfigServiceDeps,
  handleBranchRoutingConfig,
  handleCostControlConfig,
  handleSubscriptionConfig,
} from '../src/config-service';
import type { RelayPushClient } from '../src/relay-client';

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

function store(): MembershipStore {
  const members = [member('u-admin', 'admin'), member('u-viewer', 'viewer')];
  return {
    async getMembership(org, user) {
      return org === 'acme' ? (members.find((m) => m.userId === user) ?? null) : null;
    },
    async getOrganization() {
      return null;
    },
    async listMembers() {
      return members;
    },
    async listMembershipsByUser(user) {
      return members.filter((m) => m.userId === user);
    },
    async upsertMembership() {},
    async removeMembership() {},
  };
}

function deps(asUserId: string | null): ConfigServiceDeps {
  return {
    store: store(),
    authenticate: async () => (asUserId ? { userId: asUserId } : null),
    subscriptions: createInMemorySubscriptionStore(),
    costControls: createInMemoryCostControlStore(),
    branchRouting: createInMemoryBranchRoutingStore(),
  };
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://cloud.test${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('/subscriptions', () => {
  it('GET returns null before any subscription is set (viewer ok via billing:read)', async () => {
    const res = await handleSubscriptionConfig(
      req('GET', '/subscriptions?organizationId=acme'),
      deps('u-viewer'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizationId: 'acme', subscription: null });
  });

  it('PUT (admin) sets the plan, then GET reads it back', async () => {
    const d = deps('u-admin');
    const put = await handleSubscriptionConfig(
      req('PUT', '/subscriptions?organizationId=acme', {
        planId: 'pro',
        currentPeriodStart: '2026-05-01T00:00:00Z',
      }),
      d,
    );
    expect(put.status).toBe(200);
    expect(await d.subscriptions.get('acme')).toMatchObject({ planId: 'pro' });
  });

  it('PUT is denied for a viewer (needs billing:manage)', async () => {
    const res = await handleSubscriptionConfig(
      req('PUT', '/subscriptions?organizationId=acme', {
        planId: 'pro',
        currentPeriodStart: '2026-05-01T00:00:00Z',
      }),
      deps('u-viewer'),
    );
    expect(res.status).toBe(403);
  });

  it('PUT 400s on an unknown plan', async () => {
    const res = await handleSubscriptionConfig(
      req('PUT', '/subscriptions?organizationId=acme', {
        planId: 'platinum',
        currentPeriodStart: '2026-05-01T00:00:00Z',
      }),
      deps('u-admin'),
    );
    expect(res.status).toBe(400);
  });

  it('PUT 403s an admin self-assigning a privileged plan (enterprise)', async () => {
    const d = deps('u-admin');
    const res = await handleSubscriptionConfig(
      req('PUT', '/subscriptions?organizationId=acme', {
        planId: 'enterprise',
        currentPeriodStart: '2026-05-01T00:00:00Z',
      }),
      d,
    );
    expect(res.status).toBe(403);
    // The escalation must not have persisted.
    expect(await d.subscriptions.get('acme')).toBeNull();
  });

  it('PUT 400s on a malformed body', async () => {
    const res = await handleSubscriptionConfig(
      req('PUT', '/subscriptions?organizationId=acme', { planId: 'pro' }),
      deps('u-admin'),
    );
    expect(res.status).toBe(400);
  });

  it('PUT preserves the provisioning-set Stripe customer id across a plan edit', async () => {
    const d = deps('u-admin');
    // Provisioning set the customer + an internal plan directly on the store.
    await d.subscriptions.upsert({
      organizationId: 'acme',
      planId: 'enterprise',
      currentPeriodStart: '2026-05-01T00:00:00Z',
      stripeCustomerId: 'cus_123',
    });
    const res = await handleSubscriptionConfig(
      req('PUT', '/subscriptions?organizationId=acme', {
        planId: 'pro',
        currentPeriodStart: '2026-06-01T00:00:00Z',
      }),
      d,
    );
    expect(res.status).toBe(200);
    // Plan changed, but the Stripe mapping survived the org-facing edit.
    expect(await d.subscriptions.get('acme')).toMatchObject({
      planId: 'pro',
      stripeCustomerId: 'cus_123',
    });
  });

  it('401s unauthenticated, 400s without org', async () => {
    expect(
      (await handleSubscriptionConfig(req('GET', '/subscriptions?organizationId=acme'), deps(null)))
        .status,
    ).toBe(401);
    expect(
      (await handleSubscriptionConfig(req('GET', '/subscriptions'), deps('u-admin'))).status,
    ).toBe(400);
  });

  it('405s on an unsupported method', async () => {
    const res = await handleSubscriptionConfig(
      req('DELETE', '/subscriptions?organizationId=acme'),
      deps('u-admin'),
    );
    expect(res.status).toBe(405);
  });
});

describe('/cost-controls', () => {
  it('PUT (admin) sets a cap, GET reads it back; viewer is forbidden', async () => {
    const d = deps('u-admin');
    const put = await handleCostControlConfig(
      req('PUT', '/cost-controls?organizationId=acme', {
        maxRelaySessionsPerPeriod: 500,
        enforcement: 'block',
      }),
      d,
    );
    expect(put.status).toBe(200);
    expect(await d.costControls.get('acme')).toMatchObject({
      maxRelaySessionsPerPeriod: 500,
      enforcement: 'block',
    });

    const viewerGet = await handleCostControlConfig(
      req('GET', '/cost-controls?organizationId=acme'),
      deps('u-viewer'),
    );
    expect(viewerGet.status).toBe(403); // org:settings required
  });

  it('PUT accepts a null cap', async () => {
    const res = await handleCostControlConfig(
      req('PUT', '/cost-controls?organizationId=acme', {
        maxRelaySessionsPerPeriod: null,
        enforcement: 'warn',
      }),
      deps('u-admin'),
    );
    expect(res.status).toBe(200);
  });

  it('PUT 400s on an invalid enforcement mode', async () => {
    const res = await handleCostControlConfig(
      req('PUT', '/cost-controls?organizationId=acme', {
        maxRelaySessionsPerPeriod: 10,
        enforcement: 'nuke',
      }),
      deps('u-admin'),
    );
    expect(res.status).toBe(400);
  });
});

describe('/branch-routing', () => {
  it('PUT (admin) sets the policy, GET reads it back; viewer is forbidden', async () => {
    const d = deps('u-admin');
    const put = await handleBranchRoutingConfig(
      req('PUT', '/branch-routing?organizationId=acme', {
        defaultBaseBranch: 'develop',
        allowedBranchPatterns: ['feat/*', 'fix/*'],
      }),
      d,
    );
    expect(put.status).toBe(200);
    expect(await d.branchRouting.get('acme')).toMatchObject({
      defaultBaseBranch: 'develop',
      allowedBranchPatterns: ['feat/*', 'fix/*'],
    });

    const viewerGet = await handleBranchRoutingConfig(
      req('GET', '/branch-routing?organizationId=acme'),
      deps('u-viewer'),
    );
    expect(viewerGet.status).toBe(403); // org:settings required
  });

  it('PUT accepts a null defaultBaseBranch and empty patterns', async () => {
    const res = await handleBranchRoutingConfig(
      req('PUT', '/branch-routing?organizationId=acme', {
        defaultBaseBranch: null,
        allowedBranchPatterns: [],
      }),
      deps('u-admin'),
    );
    expect(res.status).toBe(200);
  });

  it('PUT 400s on a malformed body', async () => {
    const res = await handleBranchRoutingConfig(
      req('PUT', '/branch-routing?organizationId=acme', { allowedBranchPatterns: 'feat/*' }),
      deps('u-admin'),
    );
    expect(res.status).toBe(400);
  });
});

describe('/branch-routing live propagation', () => {
  type Push = { organizationId: string; sessionId: string; frame: unknown };

  function recordingRelay(result = true): { relay: RelayPushClient; pushes: Push[] } {
    const pushes: Push[] = [];
    return {
      pushes,
      relay: {
        async pushToSession(organizationId, sessionId, frame) {
          pushes.push({ organizationId, sessionId, frame });
          return result;
        },
      },
    };
  }

  function session(organizationId: string, sessionId: string): ActiveSession {
    return { organizationId, sessionId, connectedAt: '2026-05-01T00:00:00Z' };
  }

  function put(d: ConfigServiceDeps) {
    return handleBranchRoutingConfig(
      req('PUT', '/branch-routing?organizationId=acme', {
        defaultBaseBranch: 'develop',
        allowedBranchPatterns: ['feat/*'],
      }),
      d,
    );
  }

  it('pushes a set_branch_routing frame to each connected session of the org', async () => {
    const { relay, pushes } = recordingRelay();
    const activeSessions = createInMemoryActiveSessionRegistry([
      session('acme', 's-1'),
      session('acme', 's-2'),
      session('other', 's-x'), // a different org — must not receive the push
    ]);
    const res = await put({ ...deps('u-admin'), activeSessions, relay });

    expect(res.status).toBe(200);
    expect(pushes.map((p) => p.sessionId).sort()).toEqual(['s-1', 's-2']);
    // Every push carries the org so it targets the tenant-scoped DO.
    expect(pushes.every((p) => p.organizationId === 'acme')).toBe(true);
    expect(pushes[0]?.frame).toEqual({
      type: 'set_branch_routing',
      defaultBaseBranch: 'develop',
      allowedBranchPatterns: ['feat/*'],
    });
  });

  it('GET does not push', async () => {
    const { relay, pushes } = recordingRelay();
    const activeSessions = createInMemoryActiveSessionRegistry([session('acme', 's-1')]);
    await handleBranchRoutingConfig(req('GET', '/branch-routing?organizationId=acme'), {
      ...deps('u-admin'),
      activeSessions,
      relay,
    });
    expect(pushes).toHaveLength(0);
  });

  it('still 200s when there are no connected sessions', async () => {
    const { relay, pushes } = recordingRelay();
    const activeSessions = createInMemoryActiveSessionRegistry();
    const res = await put({ ...deps('u-admin'), activeSessions, relay });
    expect(res.status).toBe(200);
    expect(pushes).toHaveLength(0);
  });

  it('is best-effort: a failed push does not fail the PUT', async () => {
    const { relay } = recordingRelay(false);
    const activeSessions = createInMemoryActiveSessionRegistry([session('acme', 's-1')]);
    const res = await put({ ...deps('u-admin'), activeSessions, relay });
    expect(res.status).toBe(200);
  });

  it('is best-effort: a throwing registry does not fail the PUT', async () => {
    const { relay } = recordingRelay();
    const activeSessions = createInMemoryActiveSessionRegistry();
    activeSessions.listByOrg = async () => {
      throw new Error('db down');
    };
    const res = await put({ ...deps('u-admin'), activeSessions, relay });
    expect(res.status).toBe(200);
  });

  it('does not push when the relay client is not wired', async () => {
    const activeSessions = createInMemoryActiveSessionRegistry([session('acme', 's-1')]);
    // Only activeSessions, no relay — the half-wired case is a no-op, not a crash.
    const res = await put({ ...deps('u-admin'), activeSessions });
    expect(res.status).toBe(200);
  });
});

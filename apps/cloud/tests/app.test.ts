// SPDX-License-Identifier: Elastic-2.0
import {
  createInMemoryInvitationStore,
  createInMemorySsoConnectionStore,
  createInMemoryUserStore,
  type MembershipStore,
  type OrganizationMembership,
  type SsoConnection,
  type SsoProfile,
  type SsoProvider,
  verifySessionToken,
} from '@pinagent/ee-auth';
import { createInMemoryMeterSink, createInMemorySubscriptionStore } from '@pinagent/ee-billing';
import {
  createInMemoryAuditSink,
  createInMemoryBranchRoutingStore,
  createInMemoryCostControlStore,
} from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import { createCloudApp } from '../src/app';
import { createBearerAuthenticator } from '../src/authenticators';

const RELAY_SECRET = 'relay-secret';
const USER_TOKEN_SECRET = 'user-secret';
const STATE_SECRET = 'state-secret';
const COOKIE = 'pa_session';

const connection: SsoConnection = {
  id: 'conn-1',
  organizationId: 'acme',
  protocol: 'oidc',
  issuer: 'https://idp.test',
  domains: [],
  enabled: true,
};

const profile: SsoProfile = {
  connectionId: 'conn-1',
  subject: 'idp-user-9',
  email: 'bob@acme.com',
  displayName: 'Bob',
  groups: [],
};

// The login flow provisions the user under a synthetic id (see `users` below);
// the membership is keyed on that id, NOT the IdP subject.
const SYNTHETIC_USER_ID = 'usr_bob';

const membership: OrganizationMembership = {
  organizationId: 'acme',
  userId: SYNTHETIC_USER_ID,
  role: 'member',
  status: 'active',
  invitedAt: '2026-01-01T00:00:00Z',
  joinedAt: '2026-01-02T00:00:00Z',
};

const store: MembershipStore = {
  async getMembership(org, user) {
    return org === 'acme' && user === SYNTHETIC_USER_ID ? membership : null;
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

const provider: SsoProvider = {
  authorizationUrl: async (_c, state) => `https://idp.test/authorize?state=${state}`,
  completeLogin: async () => profile,
};

function makeApp() {
  const authenticate = createBearerAuthenticator(USER_TOKEN_SECRET, { cookieName: COOKIE });
  const audit = createInMemoryAuditSink();
  const meter = createInMemoryMeterSink();
  return createCloudApp({
    session: {
      store,
      authenticate,
      secret: RELAY_SECRET,
      relayUrl: 'wss://relay.test',
    },
    login: {
      provider,
      connections: createInMemorySsoConnectionStore([connection]),
      defaultConnectionId: connection.id,
      stateSecret: STATE_SECRET,
      userTokenSecret: USER_TOKEN_SECRET,
      cookieName: COOKIE,
      defaultReturnTo: '/',
      // Provisions the profile under a fixed synthetic id, which the membership
      // above is keyed on — so the login → /sessions handshake resolves.
      users: createInMemoryUserStore([], { generateId: () => SYNTHETIC_USER_ID }),
    },
    read: { store, users: createInMemoryUserStore(), authenticate, audit, meter },
    config: {
      store,
      authenticate,
      subscriptions: createInMemorySubscriptionStore(),
      costControls: createInMemoryCostControlStore(),
      branchRouting: createInMemoryBranchRoutingStore(),
    },
    members: {
      store,
      users: createInMemoryUserStore(),
      invitations: createInMemoryInvitationStore(),
      authenticate,
      audit,
    },
    billing: {
      subscriptions: createInMemorySubscriptionStore(),
      now: () => '2026-01-01T00:00:00.000Z',
      internalSecret: 'internal-secret',
    },
    internal: { audit, relayInternalSecret: 'internal-secret' },
  });
}

describe('createCloudApp routing', () => {
  it('serves /healthz', async () => {
    const res = await makeApp().fetch(new Request('https://cloud.test/healthz'));
    expect(res.status).toBe(200);
  });

  it('404s unknown paths', async () => {
    const res = await makeApp().fetch(new Request('https://cloud.test/nope'));
    expect(res.status).toBe(404);
  });
});

describe('end-to-end: login → session cookie → relay token', () => {
  it('drives the full handshake', async () => {
    const app = makeApp();

    // 1. Start login → redirect carries the signed state (echoed by the fake IdP).
    const start = await app.fetch(new Request('https://cloud.test/sso/start?returnTo=/projects'));
    expect(start.status).toBe(302);
    const authorizeUrl = new URL(start.headers.get('location') as string);
    const state = authorizeUrl.searchParams.get('state') as string;
    expect(state).toBeTruthy();

    // 2. IdP redirects back → callback sets the session cookie.
    const cb = await app.fetch(
      new Request(`https://cloud.test/sso/callback?code=auth-code&state=${state}`),
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/projects');
    const cookieToken = (/pa_session=([^;]+)/.exec(cb.headers.get('set-cookie') ?? '') ?? [])[1];
    expect(cookieToken).toBeTruthy();

    // 3. Exchange the session (via cookie) for a relay token.
    const sessions = await app.fetch(
      new Request('https://cloud.test/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `pa_session=${cookieToken}` },
        body: JSON.stringify({ organizationId: 'acme', sessionId: 'sess-1' }),
      }),
    );
    expect(sessions.status).toBe(200);
    const payload = (await sessions.json()) as { token: string; relayUrl: string };
    expect(payload.relayUrl).toBe('wss://relay.test');

    // 4. The relay token is valid and scoped to the org + member role.
    const verified = await verifySessionToken(payload.token, RELAY_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.tenantId).toBe('acme');
      expect(verified.claims.sessionId).toBe('sess-1');
      expect(verified.claims.role).toBe('member');
    }
  });

  it('rejects /sessions without a session cookie or bearer', async () => {
    const res = await makeApp().fetch(
      new Request('https://cloud.test/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: 'acme', sessionId: 'sess-1' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

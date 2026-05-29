// SPDX-License-Identifier: Elastic-2.0
import {
  type MembershipStore,
  type OrganizationMembership,
  type SsoConnection,
  type SsoProfile,
  type SsoProvider,
  verifySessionToken,
} from '@pinagent/ee-auth';
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

const membership: OrganizationMembership = {
  organizationId: 'acme',
  userId: 'idp-user-9', // matches profile.subject — the user mapping
  role: 'member',
  status: 'active',
  invitedAt: '2026-01-01T00:00:00Z',
  joinedAt: '2026-01-02T00:00:00Z',
};

const store: MembershipStore = {
  async getMembership(org, user) {
    return org === 'acme' && user === 'idp-user-9' ? membership : null;
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

const provider: SsoProvider = {
  authorizationUrl: async (_c, state) => `https://idp.test/authorize?state=${state}`,
  completeLogin: async () => profile,
};

function makeApp() {
  return createCloudApp({
    session: {
      store,
      authenticate: createBearerAuthenticator(USER_TOKEN_SECRET, { cookieName: COOKIE }),
      secret: RELAY_SECRET,
      relayUrl: 'wss://relay.test',
    },
    login: {
      provider,
      connection,
      stateSecret: STATE_SECRET,
      userTokenSecret: USER_TOKEN_SECRET,
      cookieName: COOKIE,
      defaultReturnTo: '/',
    },
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

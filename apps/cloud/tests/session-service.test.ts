// SPDX-License-Identifier: Elastic-2.0
import type {
  MembershipStatus,
  MembershipStore,
  OrganizationMembership,
  Role,
} from '@pinagent/ee-auth';
import { verifySessionToken } from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';
import {
  type Authenticator,
  devHeaderAuthenticator,
  handleCloudRequest,
  handleSessionRequest,
  type SessionServiceDeps,
} from '../src/session-service';

const SECRET = 'test-secret-do-not-use-in-prod';
const RELAY_URL = 'wss://relay.pinagent.test';

function membership(
  role: Role,
  status: MembershipStatus = 'active',
  joinedAt: string | null = '2026-01-01T00:00:00Z',
): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId: 'user-1',
    role,
    status,
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt,
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

/** Authenticator that always resolves to `user-1`. */
const asUser1: Authenticator = async () => ({ userId: 'user-1' });

function deps(overrides: Partial<SessionServiceDeps> = {}): SessionServiceDeps {
  return {
    store: storeWith(membership('member')),
    authenticate: asUser1,
    secret: SECRET,
    relayUrl: RELAY_URL,
    ...overrides,
  };
}

function postSessions(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://cloud.pinagent.test/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /sessions', () => {
  it('issues a relay token for an active member', async () => {
    const res = await handleSessionRequest(
      postSessions({ organizationId: 'acme', sessionId: 'sess-1' }),
      deps(),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { token: string; sessionId: string; relayUrl: string };
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.relayUrl).toBe(RELAY_URL);

    // The token is a real, relay-verifiable credential scoped to the org.
    const verified = await verifySessionToken(payload.token, SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.tenantId).toBe('acme');
      expect(verified.claims.sessionId).toBe('sess-1');
      expect(verified.claims.role).toBe('member');
    }
  });

  it('401s when the caller is unauthenticated', async () => {
    const res = await handleSessionRequest(
      postSessions({ organizationId: 'acme', sessionId: 'sess-1' }),
      deps({ authenticate: async () => null }),
    );
    expect(res.status).toBe(401);
  });

  it('405s on a non-POST method', async () => {
    const res = await handleSessionRequest(
      new Request('https://cloud.pinagent.test/sessions', { method: 'GET' }),
      deps(),
    );
    expect(res.status).toBe(405);
  });

  it('400s on a non-JSON body', async () => {
    const req = new Request('https://cloud.pinagent.test/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect((await handleSessionRequest(req, deps())).status).toBe(400);
  });

  it.each([
    { sessionId: 'sess-1' },
    { organizationId: 'acme' },
    { organizationId: '', sessionId: 'sess-1' },
    { organizationId: 'acme', sessionId: 123 },
  ])('400s on malformed body %j', async (body) => {
    expect((await handleSessionRequest(postSessions(body), deps())).status).toBe(400);
  });

  it('403s when the user is not an active member', async () => {
    const res = await handleSessionRequest(
      postSessions({ organizationId: 'acme', sessionId: 'sess-1' }),
      deps({ store: storeWith(null) }),
    );
    expect(res.status).toBe(403);
  });

  it('403s when the role lacks the required permission', async () => {
    const res = await handleSessionRequest(
      postSessions({ organizationId: 'acme', sessionId: 'sess-1' }),
      deps({ store: storeWith(membership('viewer')), requirePermission: 'conversation:write' }),
    );
    expect(res.status).toBe(403);
  });
});

describe('handleCloudRequest routing', () => {
  it('404s on an unknown path', async () => {
    const res = await handleCloudRequest(
      new Request('https://cloud.pinagent.test/nope', { method: 'POST' }),
      deps(),
    );
    expect(res.status).toBe(404);
  });
});

describe('devHeaderAuthenticator', () => {
  it('resolves the user from X-Pinagent-User', async () => {
    const req = new Request('https://x/sessions', { headers: { 'X-Pinagent-User': 'u-42' } });
    expect(await devHeaderAuthenticator(req)).toEqual({ userId: 'u-42' });
  });

  it('returns null without the header', async () => {
    expect(await devHeaderAuthenticator(new Request('https://x/sessions'))).toBeNull();
  });
});

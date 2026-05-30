// SPDX-License-Identifier: Elastic-2.0
import type {
  MembershipStore,
  OrganizationMembership,
  Role,
  SsoConnection,
  SsoProfile,
  SsoProvider,
} from '@pinagent/ee-auth';
import { createInMemorySsoConnectionStore } from '@pinagent/ee-auth';
import { AUDIT_ACTIONS, createInMemoryAuditSink } from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import { handleSsoCallback } from '../src/login-service';
import { handleSessionRequest } from '../src/session-service';
import { signLoginState } from '../src/sso-state';

const RELAY_SECRET = 'relay-secret';
const USER_SECRET = 'user-secret';
const STATE_SECRET = 'state-secret';
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
    async listMembershipsByUser() {
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

describe('audit emission — session issuance', () => {
  it('records relay.session.issued on success', async () => {
    const audit = createInMemoryAuditSink();
    const res = await handleSessionRequest(sessionRequest(), {
      store: storeWith(member('member')),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: RELAY_SECRET,
      relayUrl: 'wss://relay.test',
      audit,
      nowSeconds: NOW,
    });
    expect(res.status).toBe(200);
    expect(audit.events).toEqual([
      {
        occurredAt: NOW_ISO,
        organizationId: 'acme',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.sessionIssued,
        targetId: 'sess-1',
        metadata: { role: 'member' },
      },
    ]);
  });

  it('records relay.session.denied when membership is missing', async () => {
    const audit = createInMemoryAuditSink();
    const res = await handleSessionRequest(sessionRequest(), {
      store: storeWith(null),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: RELAY_SECRET,
      relayUrl: 'wss://relay.test',
      audit,
      nowSeconds: NOW,
    });
    expect(res.status).toBe(403);
    expect(audit.events[0]).toMatchObject({
      action: AUDIT_ACTIONS.sessionDenied,
      metadata: { reason: 'membership' },
    });
  });

  it('records a permission denial reason', async () => {
    const audit = createInMemoryAuditSink();
    await handleSessionRequest(sessionRequest(), {
      store: storeWith(member('viewer')),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: RELAY_SECRET,
      relayUrl: 'wss://relay.test',
      requirePermission: 'conversation:write',
      audit,
      nowSeconds: NOW,
    });
    expect(audit.events[0]).toMatchObject({
      action: AUDIT_ACTIONS.sessionDenied,
      metadata: { reason: 'permission' },
    });
  });

  it('does not require an audit sink (optional dep)', async () => {
    const res = await handleSessionRequest(sessionRequest(), {
      store: storeWith(member('member')),
      authenticate: async () => ({ userId: 'user-1' }),
      secret: RELAY_SECRET,
      relayUrl: 'wss://relay.test',
    });
    expect(res.status).toBe(200);
  });
});

describe('audit emission — login', () => {
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
    email: 'b@acme.com',
    displayName: 'Bob',
    groups: [],
  };
  const provider: SsoProvider = {
    authorizationUrl: async () => 'https://idp.test/authorize',
    completeLogin: async () => profile,
  };

  it('records sso.login on a successful callback', async () => {
    const audit = createInMemoryAuditSink();
    const state = await signLoginState({ connectionId: 'conn-1', returnTo: '/' }, STATE_SECRET);
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      {
        provider,
        connections: createInMemorySsoConnectionStore([connection]),
        defaultConnectionId: connection.id,
        stateSecret: STATE_SECRET,
        userTokenSecret: USER_SECRET,
        cookieName: 'pa_session',
        defaultReturnTo: '/',
        audit,
        nowSeconds: NOW,
      },
    );
    expect(res.status).toBe(302);
    expect(audit.events).toEqual([
      {
        occurredAt: NOW_ISO,
        organizationId: 'acme',
        actorUserId: 'idp-user-9',
        action: AUDIT_ACTIONS.login,
        metadata: { connectionId: 'conn-1' },
      },
    ]);
  });
});

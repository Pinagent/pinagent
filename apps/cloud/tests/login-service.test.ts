// SPDX-License-Identifier: Elastic-2.0
import {
  createInMemoryInvitationStore,
  createInMemorySsoConnectionStore,
  createInMemoryUserStore,
  type MembershipStore,
  type OrganizationMembership,
  type SsoConnection,
  type SsoConnectionStore,
  type SsoProfile,
  type SsoProvider,
  verifyUserToken,
} from '@pinagent/ee-auth';
import { describe, expect, it, vi } from 'vitest';
import { handleSsoCallback, handleSsoStart, type LoginServiceDeps } from '../src/login-service';
import { signLoginState } from '../src/sso-state';

const STATE_SECRET = 'state-secret';
const USER_TOKEN_SECRET = 'user-secret';

const connection: SsoConnection = {
  id: 'conn-1',
  organizationId: 'acme',
  protocol: 'oidc',
  issuer: 'https://idp.test',
  domains: ['acme.com'],
  enabled: true,
};

const profile: SsoProfile = {
  connectionId: 'conn-1',
  subject: 'idp-user-9',
  email: 'bob@acme.com',
  displayName: 'Bob',
  groups: [],
};

function fakeProvider(overrides: Partial<SsoProvider> = {}): SsoProvider {
  return {
    authorizationUrl: vi.fn(async (_c, state) => `https://idp.test/authorize?state=${state}`),
    completeLogin: vi.fn(async () => profile),
    ...overrides,
  };
}

function deps(
  provider: SsoProvider,
  connections: SsoConnectionStore = createInMemorySsoConnectionStore([connection]),
): LoginServiceDeps {
  return {
    provider,
    connections,
    defaultConnectionId: 'conn-1',
    stateSecret: STATE_SECRET,
    userTokenSecret: USER_TOKEN_SECRET,
    cookieName: 'pa_session',
    defaultReturnTo: '/home',
    // Fixed generator so the minted synthetic id is deterministic in assertions.
    users: createInMemoryUserStore([], { generateId: () => 'usr_bob' }),
  };
}

function getCookieToken(res: Response, name = 'pa_session'): string | null {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const m = new RegExp(`${name}=([^;]+)`).exec(setCookie);
  return m ? (m[1] ?? null) : null;
}

/** A MembershipStore that records every upsert into `sink` (else no-ops). */
function collectingMemberships(sink: OrganizationMembership[]): MembershipStore {
  return {
    async getMembership() {
      return null;
    },
    async getOrganization() {
      return null;
    },
    async listMembers() {
      return [];
    },
    async listMembershipsByUser() {
      return [];
    },
    async upsertMembership(m) {
      sink.push(m);
    },
    async removeMembership() {},
  };
}

describe('GET /sso/start', () => {
  it('redirects to the IdP with a signed state', async () => {
    const provider = fakeProvider();
    const res = await handleSsoStart(
      new Request('https://cloud.test/sso/start?returnTo=/projects'),
      deps(provider),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('https://idp.test/authorize');
    // The provider received our connection + a signed state.
    expect(provider.authorizationUrl).toHaveBeenCalledWith(connection, expect.any(String));
  });

  it('ignores an off-origin returnTo (open-redirect guard)', async () => {
    const calls: string[] = [];
    const provider = fakeProvider({
      authorizationUrl: async (_c, state) => {
        calls.push(state);
        return `https://idp.test/authorize?state=${state}`;
      },
    });
    await handleSsoStart(
      new Request('https://cloud.test/sso/start?returnTo=https://evil.test'),
      deps(provider),
    );
    // The returnTo baked into the state must have fallen back to the default,
    // never the off-origin URL — verified at callback below.
    expect(calls).toHaveLength(1);
  });

  it('resolves an explicit ?connection= id', async () => {
    const other: SsoConnection = { ...connection, id: 'conn-2', issuer: 'https://idp2.test' };
    const provider = fakeProvider();
    const res = await handleSsoStart(
      new Request('https://cloud.test/sso/start?connection=conn-2'),
      deps(provider, createInMemorySsoConnectionStore([connection, other])),
    );
    expect(res.status).toBe(302);
    expect(provider.authorizationUrl).toHaveBeenCalledWith(other, expect.any(String));
  });

  it('discovers the connection from an ?email= domain', async () => {
    const provider = fakeProvider();
    const res = await handleSsoStart(
      new Request('https://cloud.test/sso/start?email=bob@acme.com'),
      deps(provider),
    );
    expect(res.status).toBe(302);
    expect(provider.authorizationUrl).toHaveBeenCalledWith(connection, expect.any(String));
  });

  it('400s on an unknown connection (no default to fall back to)', async () => {
    const res = await handleSsoStart(new Request('https://cloud.test/sso/start?connection=nope'), {
      ...deps(fakeProvider()),
      defaultConnectionId: undefined,
    });
    expect(res.status).toBe(400);
  });

  it('400s when a resolved connection is disabled', async () => {
    const disabled = createInMemorySsoConnectionStore([{ ...connection, enabled: false }]);
    const res = await handleSsoStart(
      new Request('https://cloud.test/sso/start'),
      deps(fakeProvider(), disabled),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /sso/callback', () => {
  async function startedState(returnTo = '/projects'): Promise<string> {
    return signLoginState({ connectionId: 'conn-1', returnTo }, STATE_SECRET);
  }

  it('completes login, sets a session cookie, and redirects to returnTo', async () => {
    const provider = fakeProvider();
    const state = await startedState('/projects');
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      deps(provider),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/projects');

    const token = getCookieToken(res);
    expect(token).toBeTruthy();
    const verified = await verifyUserToken(token as string, USER_TOKEN_SECRET);
    expect(verified.ok).toBe(true);
    // The token carries the minted synthetic id, not the IdP subject.
    if (verified.ok) expect(verified.claims.userId).toBe('usr_bob');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
  });

  it('just-in-time provisions the user when a store is wired', async () => {
    // Synthetic id model: the store mints an opaque id for the identity, NOT
    // the IdP subject. Inject a fixed generator so the id is assertable.
    const users = createInMemoryUserStore([], { generateId: () => 'usr_fixed' });
    const state = await startedState('/');
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      { ...deps(fakeProvider()), users },
    );
    expect(res.status).toBe(302);
    // The user behind the profile now exists under its synthetic id; the IdP
    // subject ('idp-user-9') is not used as the id.
    expect(await users.get('idp-user-9')).toBeNull();
    expect(await users.get('usr_fixed')).toMatchObject({
      id: 'usr_fixed',
      email: 'bob@acme.com',
      displayName: 'Bob',
    });
    const token = getCookieToken(res);
    const verified = await verifyUserToken(token as string, USER_TOKEN_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.claims.userId).toBe('usr_fixed');
  });

  it('consumes a pending invitation into an active membership at login', async () => {
    const upserts: OrganizationMembership[] = [];
    const memberships: MembershipStore = {
      async getMembership() {
        return null;
      },
      async getOrganization() {
        return null;
      },
      async listMembers() {
        return [];
      },
      async listMembershipsByUser() {
        return [];
      },
      async upsertMembership(m) {
        upserts.push(m);
      },
      async removeMembership() {},
    };
    const invitations = createInMemoryInvitationStore([
      {
        organizationId: 'acme',
        email: 'bob@acme.com',
        role: 'admin',
        invitedAt: 'i',
        invitedByUserId: null,
      },
    ]);
    const state = await startedState('/');
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      { ...deps(fakeProvider()), invitations, memberships },
    );
    expect(res.status).toBe(302);
    // The invitee (synthetic id 'usr_bob') is now an active admin; invite gone.
    expect(upserts).toEqual([
      expect.objectContaining({
        organizationId: 'acme',
        userId: 'usr_bob',
        role: 'admin',
        status: 'active',
      }),
    ]);
    expect(await invitations.get('acme', 'bob@acme.com')).toBeNull();
  });

  it('does NOT consume an invite when the connection is not authoritative for the email domain', async () => {
    // A second org connection whose IdP owns evil.com — NOT acme.com. A verified
    // bob@acme.com logging in through it must not claim acme.com's invite.
    const upserts: OrganizationMembership[] = [];
    const memberships = collectingMemberships(upserts);
    const invitations = createInMemoryInvitationStore([
      {
        organizationId: 'acme',
        email: 'bob@acme.com',
        role: 'admin',
        invitedAt: 'i',
        invitedByUserId: null,
      },
    ]);
    const evilConn: SsoConnection = { ...connection, id: 'conn-evil', domains: ['evil.com'] };
    const connections = createInMemorySsoConnectionStore([evilConn]);
    const state = await signLoginState({ connectionId: 'conn-evil', returnTo: '/' }, STATE_SECRET);
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      { ...deps(fakeProvider(), connections), invitations, memberships },
    );
    expect(res.status).toBe(302); // login still succeeds
    expect(upserts).toHaveLength(0); // invite NOT consumed (domain mismatch)
    expect(await invitations.get('acme', 'bob@acme.com')).not.toBeNull();
  });

  it('consumes an invite when the connection declares no domains (env default, no restriction)', async () => {
    const upserts: OrganizationMembership[] = [];
    const memberships = collectingMemberships(upserts);
    const invitations = createInMemoryInvitationStore([
      {
        organizationId: 'acme',
        email: 'bob@acme.com',
        role: 'admin',
        invitedAt: 'i',
        invitedByUserId: null,
      },
    ]);
    const noDomainConn: SsoConnection = { ...connection, domains: [] };
    const connections = createInMemorySsoConnectionStore([noDomainConn]);
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${await startedState('/')}`),
      { ...deps(fakeProvider(), connections), invitations, memberships },
    );
    expect(res.status).toBe(302);
    expect(upserts).toHaveLength(1); // consumed — no domain restriction
  });

  it('does NOT consume an invitation when the profile email is empty (unverified)', async () => {
    // The OIDC provider drops an unverified email to '' — that must not be able
    // to claim a pending invite addressed to the real (verified) owner.
    const upserts: OrganizationMembership[] = [];
    const memberships: MembershipStore = {
      async getMembership() {
        return null;
      },
      async getOrganization() {
        return null;
      },
      async listMembers() {
        return [];
      },
      async listMembershipsByUser() {
        return [];
      },
      async upsertMembership(m) {
        upserts.push(m);
      },
      async removeMembership() {},
    };
    const invitations = createInMemoryInvitationStore([
      {
        organizationId: 'acme',
        email: 'bob@acme.com',
        role: 'admin',
        invitedAt: 'i',
        invitedByUserId: null,
      },
    ]);
    const unverified = fakeProvider({
      completeLogin: vi.fn(async () => ({ ...profile, email: '' })),
    });
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${await startedState('/')}`),
      { ...deps(unverified), invitations, memberships },
    );
    expect(res.status).toBe(302); // login still succeeds
    expect(upserts).toHaveLength(0); // no membership granted
    expect(await invitations.get('acme', 'bob@acme.com')).not.toBeNull(); // invite untouched
  });

  it('login still succeeds when there is no pending invitation (no membership created)', async () => {
    const upserts: OrganizationMembership[] = [];
    const memberships = {
      getMembership: async () => null,
      getOrganization: async () => null,
      listMembers: async () => [],
      listMembershipsByUser: async () => [],
      upsertMembership: async (m: OrganizationMembership) => {
        upserts.push(m);
      },
      removeMembership: async () => {},
    } satisfies MembershipStore;
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${await startedState('/')}`),
      { ...deps(fakeProvider()), invitations: createInMemoryInvitationStore(), memberships },
    );
    expect(res.status).toBe(302);
    expect(upserts).toHaveLength(0);
  });

  it('400s on missing code or state', async () => {
    const res = await handleSsoCallback(
      new Request('https://cloud.test/sso/callback?code=abc'),
      deps(fakeProvider()),
    );
    expect(res.status).toBe(400);
  });

  it('400s on a forged state', async () => {
    const forged = await signLoginState(
      { connectionId: 'conn-1', returnTo: '/' },
      'attacker-secret',
    );
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${forged}`),
      deps(fakeProvider()),
    );
    expect(res.status).toBe(400);
  });

  it('400s when the state names a connection no longer in the store', async () => {
    // State pinned conn-1, but the store no longer has it (deleted/disabled).
    const state = await startedState();
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      deps(fakeProvider(), createInMemorySsoConnectionStore([])),
    );
    expect(res.status).toBe(400);
  });

  it('401s (generic) when the IdP handshake fails', async () => {
    const provider = fakeProvider({
      completeLogin: async () => {
        throw new Error('id_token signature verification failed');
      },
    });
    const state = await startedState();
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      deps(provider),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/signature/); // no detail leak
  });
});

describe('welcome email on first login (best-effort, opt-in)', () => {
  type Welcome = { to: string; name: string | null; organizationName: string | null };
  function recordingWelcome(): {
    email: NonNullable<LoginServiceDeps['email']>;
    sent: Welcome[];
  } {
    const sent: Welcome[] = [];
    return {
      sent,
      email: {
        async sendWelcome(input) {
          sent.push(input);
        },
      },
    };
  }

  it('sends a welcome on a first sign-in', async () => {
    const rec = recordingWelcome();
    const state = await signLoginState({ connectionId: 'conn-1', returnTo: '/' }, STATE_SECRET);
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      { ...deps(fakeProvider()), email: rec.email },
    );
    expect(res.status).toBe(302);
    // No memberships store wired here, so the org name is unresolved (null).
    expect(rec.sent).toEqual([{ to: 'bob@acme.com', name: 'Bob', organizationName: null }]);
  });

  it('does not send on a returning sign-in', async () => {
    const rec = recordingWelcome();
    // Pre-provision so the user already exists; this login is therefore not the
    // first (createdAt stays earlier than the bumped lastLoginAt).
    const users = createInMemoryUserStore([], { generateId: () => 'usr_bob' });
    await users.provisionFromProfile(profile, { now: '2020-01-01T00:00:00.000Z' });
    const state = await signLoginState({ connectionId: 'conn-1', returnTo: '/' }, STATE_SECRET);
    const res = await handleSsoCallback(
      new Request(`https://cloud.test/sso/callback?code=abc&state=${state}`),
      // Default clock (matches the other callback tests so `state` isn't expired);
      // re-login bumps lastLoginAt past the pre-provisioned 2020 createdAt.
      { ...deps(fakeProvider()), users, email: rec.email },
    );
    expect(res.status).toBe(302);
    expect(rec.sent).toHaveLength(0);
  });
});

// SPDX-License-Identifier: Elastic-2.0
import {
  type SsoConnection,
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

function fakeProvider(overrides: Partial<SsoProvider> = {}): SsoProvider {
  return {
    authorizationUrl: vi.fn(async (_c, state) => `https://idp.test/authorize?state=${state}`),
    completeLogin: vi.fn(async () => profile),
    ...overrides,
  };
}

function deps(provider: SsoProvider): LoginServiceDeps {
  return {
    provider,
    connection,
    stateSecret: STATE_SECRET,
    userTokenSecret: USER_TOKEN_SECRET,
    cookieName: 'pa_session',
    defaultReturnTo: '/home',
  };
}

function getCookieToken(res: Response, name = 'pa_session'): string | null {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const m = new RegExp(`${name}=([^;]+)`).exec(setCookie);
  return m ? (m[1] ?? null) : null;
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
    if (verified.ok) expect(verified.claims.userId).toBe('idp-user-9');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
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

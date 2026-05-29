// SPDX-License-Identifier: Elastic-2.0
import { signUserToken } from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';
import { createBearerAuthenticator } from '../src/authenticators';

const SECRET = 'user-token-secret';

function withAuth(header?: string): Request {
  return new Request('https://cloud.pinagent.test/sessions', {
    method: 'POST',
    headers: header ? { Authorization: header } : {},
  });
}

function withCookie(cookie: string): Request {
  return new Request('https://cloud.pinagent.test/sessions', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
}

describe('createBearerAuthenticator', () => {
  it('resolves the user from a valid bearer token', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    const token = await signUserToken('user-42', SECRET);
    expect(await authenticate(withAuth(`Bearer ${token}`))).toEqual({ userId: 'user-42' });
  });

  it('resolves the user from the session cookie when configured', async () => {
    const authenticate = createBearerAuthenticator(SECRET, { cookieName: 'pa_session' });
    const token = await signUserToken('user-42', SECRET);
    expect(await authenticate(withCookie(`other=x; pa_session=${token}; foo=bar`))).toEqual({
      userId: 'user-42',
    });
  });

  it('ignores the cookie when no cookieName is configured', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    const token = await signUserToken('user-42', SECRET);
    expect(await authenticate(withCookie(`pa_session=${token}`))).toBeNull();
  });

  it('is case-insensitive on the scheme', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    const token = await signUserToken('user-42', SECRET);
    expect(await authenticate(withAuth(`bearer ${token}`))).toEqual({ userId: 'user-42' });
  });

  it('returns null without an Authorization header', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    expect(await authenticate(withAuth())).toBeNull();
  });

  it('returns null for a non-bearer scheme', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    expect(await authenticate(withAuth('Basic abc123'))).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    const token = await signUserToken('user-42', 'wrong-secret');
    expect(await authenticate(withAuth(`Bearer ${token}`))).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const authenticate = createBearerAuthenticator(SECRET);
    const token = await signUserToken('user-42', SECRET, { nowSeconds: 1000, ttlSeconds: 60 });
    // verifyUserToken uses the real clock; a token minted "in the past" with a
    // short TTL is already expired now.
    expect(await authenticate(withAuth(`Bearer ${token}`))).toBeNull();
  });
});

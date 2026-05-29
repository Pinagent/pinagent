// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { signUserToken, verifyUserToken } from '../src/user-token';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('user token round-trip', () => {
  it('signs and verifies, preserving the user id', async () => {
    const token = await signUserToken('user-1', SECRET, { nowSeconds: 1000, ttlSeconds: 3600 });
    const result = await verifyUserToken(token, SECRET, { nowSeconds: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toEqual({ userId: 'user-1', iat: 1000, exp: 4600 });
    }
  });
});

describe('user token rejection', () => {
  it('rejects a tampered signature', async () => {
    const token = await signUserToken('user-1', SECRET);
    const [payload, sig] = token.split('.');
    const flipped = (sig?.[0] === 'A' ? 'B' : 'A') + sig?.slice(1);
    expect(await verifyUserToken(`${payload}.${flipped}`, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signUserToken('user-1', SECRET);
    expect(await verifyUserToken(token, 'other-secret')).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an expired token', async () => {
    const token = await signUserToken('user-1', SECRET, { nowSeconds: 1000, ttlSeconds: 60 });
    expect(await verifyUserToken(token, SECRET, { nowSeconds: 1061 })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it.each(['', 'no-dot', 'not-base64!.sig'])('rejects malformed token %j', async (bad) => {
    expect((await verifyUserToken(bad, SECRET)).ok).toBe(false);
  });

  it('rejects a well-signed token missing userId', async () => {
    // A token we signed with the right secret but the wrong claim shape must
    // still be rejected at the shape guard (malformed), not accepted.
    const { signClaims } = await import('../src/token-codec');
    const forged = await signClaims({ iat: 1000, exp: 9_999_999_999 }, SECRET);
    expect(await verifyUserToken(forged, SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });
});

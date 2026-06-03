// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { signSessionToken, verifySessionToken } from '../src/session-token';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('session token round-trip', () => {
  it('signs and verifies, preserving claims', async () => {
    const token = await signSessionToken(
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
      {
        nowSeconds: 1000,
        ttlSeconds: 3600,
      },
    );
    const result = await verifySessionToken(token, SECRET, { nowSeconds: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toEqual({
        tenantId: 'acme',
        sessionId: 'sess-1',
        role: 'member',
        aud: 'client',
        iat: 1000,
        exp: 4600,
      });
    }
  });

  it('round-trips values needing base64url-safe encoding', async () => {
    const token = await signSessionToken(
      { tenantId: 'org/with+slash', sessionId: 'sömé-üñïçødé', role: 'admin', audience: 'device' },
      SECRET,
    );
    const result = await verifySessionToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.tenantId).toBe('org/with+slash');
      expect(result.claims.sessionId).toBe('sömé-üñïçødé');
    }
  });
});

describe('session token rejection', () => {
  it('rejects a tampered signature', async () => {
    const token = await signSessionToken(
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
    );
    const [payload, sig] = token.split('.');
    const flipped = (sig?.[0] === 'A' ? 'B' : 'A') + sig?.slice(1);
    const result = await verifySessionToken(`${payload}.${flipped}`, SECRET);
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a forged payload carried under a stale signature', async () => {
    // The security-critical case: a valid, decodable payload that was never
    // signed with this secret. "evil" claims + a real-but-unrelated sig.
    const honest = await signSessionToken(
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
    );
    const evil = await signSessionToken(
      { tenantId: 'evil', sessionId: 'sess-1', role: 'owner', audience: 'client' },
      SECRET,
    );
    const forged = `${evil.split('.')[0]}.${honest.split('.')[1]}`;
    const result = await verifySessionToken(forged, SECRET);
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSessionToken(
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
    );
    const result = await verifySessionToken(token, 'a-different-secret');
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an expired token', async () => {
    const token = await signSessionToken(
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
      {
        nowSeconds: 1000,
        ttlSeconds: 60,
      },
    );
    const result = await verifySessionToken(token, SECRET, { nowSeconds: 1061 });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('treats the expiry boundary as expired', async () => {
    const token = await signSessionToken(
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
      {
        nowSeconds: 1000,
        ttlSeconds: 60,
      },
    );
    // exp === now → expired (exclusive upper bound).
    const result = await verifySessionToken(token, SECRET, { nowSeconds: 1060 });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it.each([
    '',
    'no-dot',
    '.onlysig',
    'onlypayload.',
    'not-base64!.sig',
  ])('rejects malformed token %j', async (bad) => {
    const result = await verifySessionToken(bad, SECRET);
    expect(result.ok).toBe(false);
  });

  it('rejects a well-signed token carrying an unknown role', async () => {
    // A token we minted ourselves but with a role outside the RBAC matrix —
    // claims validation must reject it before it reaches authorization.
    const forged = await signSessionToken(
      // biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the Role type.
      { tenantId: 'acme', sessionId: 'sess-1', role: 'superadmin' as any, audience: 'client' },
      SECRET,
    );
    const result = await verifySessionToken(forged, SECRET);
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a well-signed token with a missing or unknown audience', async () => {
    // An `aud` outside {device, client} (or absent) must fail claims validation
    // so it can never satisfy the relay's path↔audience binding.
    const forged = await signSessionToken(
      // biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the audience type.
      { tenantId: 'acme', sessionId: 'sess-1', role: 'member', audience: 'both' as any },
      SECRET,
    );
    const result = await verifySessionToken(forged, SECRET);
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });
});

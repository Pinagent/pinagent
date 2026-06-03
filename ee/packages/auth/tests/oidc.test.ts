// SPDX-License-Identifier: Elastic-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { SsoError } from '../src/errors';
import type { JwkKey } from '../src/jwt';
import { createOidcProvider, deriveOidcNonce } from '../src/oidc';
import type { SsoConnection } from '../src/sso';

const ISSUER = 'https://idp.test';
const CLIENT_ID = 'client-abc';
const NONCE_SECRET = 'nonce-hmac-secret';
const NOW = 1_000_000;
const STATE = 'state-123';

const connection: SsoConnection = {
  id: 'conn-1',
  organizationId: 'acme',
  protocol: 'oidc',
  issuer: ISSUER,
  domains: ['acme.com'],
  enabled: true,
};

// ---- crypto fixtures (generated once) ----
let signingKey: CryptoKey;
let publicJwk: JwkKey;
let foreignKey: CryptoKey; // a key NOT in the JWKS — for bad-signature tests

async function generateRsa(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

beforeAll(async () => {
  const pair = await generateRsa();
  signingKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  foreignKey = (await generateRsa()).privateKey;
});

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signJwt(
  payload: Record<string, unknown>,
  opts: { key?: CryptoKey; header?: Record<string, unknown> } = {},
): Promise<string> {
  const header = opts.header ?? { alg: 'RS256', typ: 'JWT', kid: 'test-key-1' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    opts.key ?? signingKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

async function defaultIdToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return signJwt({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'idp-user-1',
    email: 'alice@acme.com',
    email_verified: true,
    name: 'Alice',
    groups: ['eng', 'admins'],
    nonce: await deriveOidcNonce(NONCE_SECRET, STATE),
    iat: NOW,
    exp: NOW + 300,
    ...overrides,
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a provider whose token endpoint returns `tokenResponse`. */
function providerWithToken(tokenResponse: () => Response) {
  const fetchFn = async (url: string): Promise<Response> => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url === `${ISSUER}/token`) return tokenResponse();
    if (url === `${ISSUER}/jwks`) return json({ keys: [publicJwk] });
    return new Response('not found', { status: 404 });
  };
  return createOidcProvider({
    clientFor: () => ({
      clientId: CLIENT_ID,
      clientSecret: 'shh',
      redirectUri: 'https://cloud.pinagent.test/sso/callback',
    }),
    nonceSecret: NONCE_SECRET,
    fetch: fetchFn,
    nowSeconds: () => NOW,
  });
}

async function providerForIdToken(idToken: string) {
  return providerWithToken(() => json({ id_token: idToken, token_type: 'Bearer' }));
}

describe('createOidcProvider.authorizationUrl', () => {
  it('builds the authorize URL from discovery with state + derived nonce', async () => {
    const provider = await providerForIdToken(await defaultIdToken());
    const url = new URL(await provider.authorizationUrl(connection, STATE));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('https://cloud.pinagent.test/sso/callback');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe(STATE);
    expect(url.searchParams.get('nonce')).toBe(await deriveOidcNonce(NONCE_SECRET, STATE));
  });
});

describe('createOidcProvider.completeLogin', () => {
  it('exchanges the code and returns a validated profile', async () => {
    const provider = await providerForIdToken(await defaultIdToken());
    const profile = await provider.completeLogin(connection, {
      payload: 'auth-code',
      state: STATE,
    });
    expect(profile).toEqual({
      connectionId: 'conn-1',
      subject: 'idp-user-1',
      email: 'alice@acme.com',
      displayName: 'Alice',
      groups: ['eng', 'admins'],
    });
  });

  it('drops the email when email_verified is false (no invite takeover)', async () => {
    const provider = await providerForIdToken(
      await defaultIdToken({ email: 'victim@acme.com', email_verified: false }),
    );
    const profile = await provider.completeLogin(connection, {
      payload: 'auth-code',
      state: STATE,
    });
    expect(profile.email).toBe(''); // unverified → not trusted
    expect(profile.subject).toBe('idp-user-1'); // identity still resolved
  });

  it('drops the email when email_verified is absent', async () => {
    const provider = await providerForIdToken(
      await defaultIdToken({ email: 'victim@acme.com', email_verified: undefined }),
    );
    const profile = await provider.completeLogin(connection, {
      payload: 'auth-code',
      state: STATE,
    });
    expect(profile.email).toBe('');
  });

  it('rejects an id_token whose nonce does not match the state', async () => {
    const provider = await providerForIdToken(await defaultIdToken({ nonce: 'tampered' }));
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toBeInstanceOf(SsoError);
  });

  it('rejects an expired id_token', async () => {
    const provider = await providerForIdToken(await defaultIdToken({ exp: NOW - 3600 }));
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toThrow(/expired/);
  });

  it('rejects an audience mismatch', async () => {
    const provider = await providerForIdToken(await defaultIdToken({ aud: 'someone-else' }));
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toThrow(/audience/);
  });

  it('rejects an issuer mismatch', async () => {
    const provider = await providerForIdToken(await defaultIdToken({ iss: 'https://evil.test' }));
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toThrow(/issuer/);
  });

  it('rejects an id_token signed by a key not in the JWKS', async () => {
    const provider = await providerForIdToken(
      await signJwt(
        {
          iss: ISSUER,
          aud: CLIENT_ID,
          sub: 'idp-user-1',
          nonce: await deriveOidcNonce(NONCE_SECRET, STATE),
          exp: NOW + 300,
        },
        { key: foreignKey },
      ),
    );
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toThrow(/signature/);
  });

  it('rejects a non-RS256 alg (no algorithm downgrade)', async () => {
    const downgraded = await signJwt(
      { iss: ISSUER, aud: CLIENT_ID, sub: 'x', exp: NOW + 300 },
      { header: { alg: 'none', typ: 'JWT' } },
    );
    const provider = await providerForIdToken(downgraded);
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toThrow(/RS256/);
  });

  it('surfaces a failed token exchange', async () => {
    const provider = providerWithToken(() => json({ error: 'invalid_grant' }, 400));
    await expect(
      provider.completeLogin(connection, { payload: 'bad-code', state: STATE }),
    ).rejects.toThrow(/token exchange failed/);
  });

  it('rejects a token response with no id_token', async () => {
    const provider = providerWithToken(() => json({ access_token: 'a', token_type: 'Bearer' }));
    await expect(
      provider.completeLogin(connection, { payload: 'auth-code', state: STATE }),
    ).rejects.toThrow(/missing id_token/);
  });
});

describe('createOidcProvider discovery', () => {
  /** Provider whose discovery doc self-reports `metadataIssuer`. */
  function providerWithDiscoveredIssuer(metadataIssuer: string) {
    const fetchFn = async (url: string): Promise<Response> => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return json({
          issuer: metadataIssuer,
          authorization_endpoint: `${metadataIssuer}/authorize`,
          token_endpoint: `${metadataIssuer}/token`,
          jwks_uri: `${metadataIssuer}/jwks`,
        });
      }
      return new Response('not found', { status: 404 });
    };
    return createOidcProvider({
      clientFor: () => ({
        clientId: CLIENT_ID,
        clientSecret: 'shh',
        redirectUri: 'https://cloud.pinagent.test/sso/callback',
      }),
      nonceSecret: NONCE_SECRET,
      fetch: fetchFn,
      nowSeconds: () => NOW,
    });
  }

  it('rejects when the discovered issuer differs from the configured issuer', async () => {
    // The metadata's self-reported issuer is attacker-controlled here; if we
    // trusted it, the swapped-in authorize/token/jwks endpoints would be used.
    const provider = providerWithDiscoveredIssuer('https://evil.test');
    await expect(provider.authorizationUrl(connection, STATE)).rejects.toThrow(/issuer mismatch/);
  });

  it('accepts a discovered issuer that differs only by a trailing slash', async () => {
    const provider = providerWithDiscoveredIssuer(`${ISSUER}/`);
    const url = await provider.authorizationUrl(connection, STATE);
    expect(url).toContain('/authorize');
    expect(url).toContain(`client_id=${CLIENT_ID}`);
  });
});

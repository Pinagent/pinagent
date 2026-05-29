// SPDX-License-Identifier: Elastic-2.0
import { SsoError } from './errors';
import { base64UrlToBytes, decodeUtf8 } from './token-codec';

/**
 * Minimal RS256 JWT verification for OIDC ID tokens, on WebCrypto (so it runs
 * in both `workerd` and Node). We only support `RS256` — the algorithm every
 * mainstream OIDC IdP signs ID tokens with — and reject anything else rather
 * than trusting an attacker-chosen `alg` (the classic JWT downgrade pitfall).
 */

/**
 * A JWKS key. `JsonWebKey` (lib.dom) omits `kid`, which JWKS entries carry and
 * we match the ID token header against — so we widen it here.
 */
export type JwkKey = JsonWebKey & { kid?: string };

/** A JSON Web Key Set, as served from an IdP's `jwks_uri`. */
export interface Jwks {
  keys: JwkKey[];
}

export interface IdTokenExpectations {
  /** Required `iss` claim (the IdP issuer). */
  issuer: string;
  /** The `aud` claim must contain this client id. */
  audience: string;
  /** When set, the `nonce` claim must match exactly. */
  nonce?: string;
  /** Current time, epoch seconds. */
  nowSeconds: number;
  /** Allowed clock skew when checking `exp`, seconds (default 60). */
  clockToleranceSeconds?: number;
}

export interface IdTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  email?: string;
  name?: string;
  nonce?: string;
  groups?: unknown;
  [claim: string]: unknown;
}

interface JwtHeader {
  alg: string;
  kid?: string;
}

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * Verify an OIDC ID token's signature against `jwks` and validate its
 * `iss` / `aud` / `exp` / `nonce`. Returns the decoded claims, or throws
 * {@link SsoError} on any failure.
 */
export async function verifyIdToken(
  token: string,
  jwks: Jwks,
  expect: IdTokenExpectations,
): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new SsoError('malformed id_token');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = decodeJson<JwtHeader>(headerB64, 'id_token header');
  if (header.alg !== 'RS256') {
    throw new SsoError(`unsupported id_token alg "${header.alg}" (only RS256)`);
  }

  const jwk = selectKey(jwks, header.kid);
  const key = await importVerifyKey(jwk);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`) as Uint8Array<ArrayBuffer>;
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(sigB64),
    data,
  );
  if (!valid) throw new SsoError('id_token signature verification failed');

  const claims = decodeJson<IdTokenClaims>(payloadB64, 'id_token payload');
  validateClaims(claims, expect);
  return claims;
}

function validateClaims(claims: IdTokenClaims, expect: IdTokenExpectations): void {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new SsoError('id_token missing sub');
  }
  if (claims.iss !== expect.issuer) {
    throw new SsoError('id_token issuer mismatch');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expect.audience)) {
    throw new SsoError('id_token audience mismatch');
  }
  const tolerance = expect.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (typeof claims.exp !== 'number' || claims.exp + tolerance <= expect.nowSeconds) {
    throw new SsoError('id_token expired');
  }
  if (expect.nonce !== undefined && claims.nonce !== expect.nonce) {
    throw new SsoError('id_token nonce mismatch');
  }
}

function selectKey(jwks: Jwks, kid: string | undefined): JwkKey {
  const rsaKeys = jwks.keys.filter((k) => k.kty === 'RSA');
  if (rsaKeys.length === 0) throw new SsoError('no RSA keys in JWKS');
  if (kid === undefined) {
    if (rsaKeys.length === 1) return rsaKeys[0] as JwkKey;
    throw new SsoError('id_token has no kid but JWKS has multiple keys');
  }
  const match = rsaKeys.find((k) => k.kid === kid);
  if (!match) throw new SsoError(`no JWKS key matches kid "${kid}"`);
  return match;
}

function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

function decodeJson<T>(segment: string, what: string): T {
  try {
    return JSON.parse(decodeUtf8(base64UrlToBytes(segment))) as T;
  } catch {
    throw new SsoError(`malformed ${what}`);
  }
}

// SPDX-License-Identifier: Elastic-2.0
import { isRole, type Role } from './rbac';

/**
 * Signed session tokens for the cloud relay.
 *
 * A session token authorizes one WebSocket connection to one tenant
 * session on `@pinagent/ee-relay`. Both sides of a relay session — the
 * dev machine's agent-runner (device) and the browser/dock clients —
 * present a token scoped to the *same* `sessionId`, which is how they
 * land on the same Durable Object.
 *
 * Format is a compact, JWT-adjacent `<payload>.<sig>`:
 *   - `payload` = base64url(JSON(SessionClaims))
 *   - `sig`     = base64url(HMAC-SHA256(payload, secret))
 *
 * We deliberately avoid a JWT library: the only algorithm we need is
 * HMAC-SHA256, and WebCrypto (`crypto.subtle`) ships in both `workerd`
 * (where the relay verifies) and Node (where tokens are minted). Keeping
 * to the Web Crypto + base64url primitives means this one module runs
 * unchanged in either runtime.
 */

export interface SessionClaims {
  /** Billing/RBAC tenant the session belongs to (an organization id). */
  tenantId: string;
  /** Relay session id — namespaces the Durable Object. */
  sessionId: string;
  /**
   * The member's role within the tenant, carried in the token so the relay
   * can apply RBAC per connection without a round-trip to the membership
   * store. Issued by {@link issueRelaySessionToken}.
   */
  role: Role;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

export interface SignOptions {
  /** Token lifetime in seconds (default 1 hour). */
  ttlSeconds?: number;
  /** Override the issued-at clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

const DEFAULT_TTL_SECONDS = 3_600;

/**
 * Mint a signed token for `{ tenantId, sessionId, role }`. Prefer
 * {@link issueRelaySessionToken}, which derives these from a verified
 * organization membership; call this directly only when the claims are
 * already trusted.
 */
export async function signSessionToken(
  input: { tenantId: string; sessionId: string; role: Role },
  secret: string,
  opts: SignOptions = {},
): Promise<string> {
  const now = opts.nowSeconds ?? nowSeconds();
  const claims: SessionClaims = {
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    role: input.role,
    iat: now,
    exp: now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const payload = textToBase64Url(JSON.stringify(claims));
  const sig = await hmac(payload, secret);
  return `${payload}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify a token's signature and expiry. Returns the decoded claims on
 * success, or a typed reason on failure (so the caller can log *why* a
 * connection was rejected without leaking it to the client).
 *
 * Signature comparison goes through `crypto.subtle.verify`, which is
 * constant-time — don't reimplement the compare by hand.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  opts: { nowSeconds?: number } = {},
): Promise<VerifyResult> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let sig: Uint8Array<ArrayBuffer>;
  let claims: unknown;
  try {
    sig = base64UrlToBytes(sigPart);
    claims = JSON.parse(decodeUtf8(base64UrlToBytes(payload)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isSessionClaims(claims)) return { ok: false, reason: 'malformed' };

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, sig, encodeUtf8(payload));
  if (!valid) return { ok: false, reason: 'bad-signature' };

  if (claims.exp <= (opts.nowSeconds ?? nowSeconds())) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

// ---------- internals ----------

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isSessionClaims(value: unknown): value is SessionClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.tenantId === 'string' &&
    typeof c.sessionId === 'string' &&
    isRole(c.role) &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number'
  );
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encodeUtf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeUtf8(data)));
}

// WebCrypto's `BufferSource` parameter type resolves to
// `ArrayBufferView<ArrayBuffer>` under TS's generic-TypedArray lib, so the
// byte helpers are annotated `Uint8Array<ArrayBuffer>` — which is what both
// `TextEncoder.encode` and `new Uint8Array(length)` produce at runtime.
function encodeUtf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function textToBase64Url(s: string): string {
  return bytesToBase64Url(encodeUtf8(s));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

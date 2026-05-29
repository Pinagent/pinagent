// SPDX-License-Identifier: Elastic-2.0

/**
 * Shared codec for the package's signed tokens (relay session tokens and
 * user-identity tokens). One audited HMAC-SHA256 implementation, so the
 * security-sensitive crypto lives in exactly one place.
 *
 * Format is a compact, JWT-adjacent `<payload>.<sig>`:
 *   - `payload` = base64url(JSON(claims))   — claims include `exp` (epoch s)
 *   - `sig`     = base64url(HMAC-SHA256(payload, secret))
 *
 * We deliberately avoid a JWT library: HMAC-SHA256 is the only algorithm we
 * need, and WebCrypto (`crypto.subtle`) + base64url ship in both `workerd`
 * and Node, so this runs unchanged in either runtime.
 */

export type CodecFailure = 'malformed' | 'bad-signature' | 'expired';

export type VerifyOutcome<T> = { ok: true; claims: T } | { ok: false; reason: CodecFailure };

/** Current time in epoch seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Sign a claims object (which must already include `iat`/`exp`). */
export async function signClaims(claims: object, secret: string): Promise<string> {
  const payload = textToBase64Url(JSON.stringify(claims));
  const sig = await hmac(payload, secret);
  return `${payload}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify a token's shape, signature, and expiry, returning typed claims on
 * success or a typed failure reason. Shape validation is delegated to
 * `isValid` so each token type owns its own claim schema.
 *
 * Order matches the reason precedence: malformed (undecodable / wrong shape)
 * → bad-signature → expired. Signature comparison goes through
 * `crypto.subtle.verify` (constant-time) — never hand-roll the compare.
 */
export async function verifyClaims<T extends { exp: number }>(
  token: string,
  secret: string,
  isValid: (value: unknown) => value is T,
  opts: { nowSeconds?: number } = {},
): Promise<VerifyOutcome<T>> {
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
  if (!isValid(claims)) return { ok: false, reason: 'malformed' };

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, sig, encodeUtf8(payload));
  if (!valid) return { ok: false, reason: 'bad-signature' };

  if (claims.exp <= (opts.nowSeconds ?? nowSeconds())) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

// ---------- internals ----------

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

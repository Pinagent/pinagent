// SPDX-License-Identifier: Elastic-2.0
/**
 * Authenticated symmetric encryption for secrets stored at rest — today the
 * per-connection OIDC `client_secret`. AES-256-GCM via WebCrypto so the one
 * module runs in both `workerd` and Node, matching the token layer's
 * "WebCrypto, no third-party crypto libs" rule.
 *
 * The key-encryption-key (KEK) is a 32-byte secret supplied as base64url
 * (`SSO_CONNECTION_KEK`). Each seal uses a fresh random 96-bit IV; the GCM
 * auth tag means tampering (or a wrong key) fails closed at `openSecret`.
 *
 * This is envelope-free single-key encryption — fine for a handful of IdP
 * client secrets. A KMS/key-rotation story can slot behind the same two
 * functions later (e.g. prepend a key id to the sealed form).
 */
import { base64UrlToBytes, decodeUtf8 } from './token-codec';

/** Ciphertext + the IV it was sealed under, both base64url. */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
}

const IV_BYTES = 12; // 96-bit nonce — the GCM standard.
const KEY_BYTES = 32; // AES-256.

/** Seal `plaintext` under the base64url KEK. */
export async function sealSecret(plaintext: string, kekBase64Url: string): Promise<SealedSecret> {
  const key = await importKey(kekBase64Url);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeUtf8(plaintext));
  return { ciphertext: bytesToBase64Url(new Uint8Array(ct)), iv: bytesToBase64Url(iv) };
}

/**
 * Open a {@link SealedSecret} with the base64url KEK. Throws if the key is
 * wrong or the ciphertext/IV was tampered with (GCM tag mismatch).
 */
export async function openSecret(sealed: SealedSecret, kekBase64Url: string): Promise<string> {
  const key = await importKey(kekBase64Url);
  const iv = base64UrlToBytes(sealed.iv);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64UrlToBytes(sealed.ciphertext),
  );
  return decodeUtf8(new Uint8Array(pt));
}

async function importKey(kekBase64Url: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(kekBase64Url);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error(
      `SSO connection KEK must be ${KEY_BYTES} bytes (base64url), got ${raw.byteLength}`,
    );
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function encodeUtf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

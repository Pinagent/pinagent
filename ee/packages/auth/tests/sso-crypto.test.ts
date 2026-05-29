// SPDX-License-Identifier: Elastic-2.0
/**
 * `sealSecret` / `openSecret` — AES-256-GCM at-rest encryption for IdP
 * client secrets. Pins the round-trip, that each seal is non-deterministic
 * (fresh IV), and that the GCM auth tag fails closed on a wrong key or
 * tampered ciphertext.
 */
import { openSecret, sealSecret } from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';

// 32 raw bytes, base64url — a valid AES-256 KEK.
const KEK = Buffer.alloc(32, 7).toString('base64url');
const OTHER_KEK = Buffer.alloc(32, 9).toString('base64url');

describe('sealSecret / openSecret', () => {
  it('round-trips a secret', async () => {
    const sealed = await sealSecret('super-secret-value', KEK);
    expect(await openSecret(sealed, KEK)).toBe('super-secret-value');
  });

  it('produces a fresh IV each time (ciphertext differs for the same input)', async () => {
    const a = await sealSecret('same', KEK);
    const b = await sealSecret('same', KEK);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // ...but both still open to the same plaintext.
    expect(await openSecret(a, KEK)).toBe('same');
    expect(await openSecret(b, KEK)).toBe('same');
  });

  it('fails to open under a different key', async () => {
    const sealed = await sealSecret('secret', KEK);
    await expect(openSecret(sealed, OTHER_KEK)).rejects.toThrow();
  });

  it('fails to open tampered ciphertext (GCM auth tag)', async () => {
    const sealed = await sealSecret('secret', KEK);
    const tampered = { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}AA` };
    await expect(openSecret(tampered, KEK)).rejects.toThrow();
  });

  it('rejects a KEK of the wrong length', async () => {
    const shortKek = Buffer.alloc(16, 1).toString('base64url');
    await expect(sealSecret('x', shortKek)).rejects.toThrow(/32 bytes/);
  });
});

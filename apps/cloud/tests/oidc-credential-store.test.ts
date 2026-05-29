// SPDX-License-Identifier: Elastic-2.0
/**
 * `createPgOidcCredentialStore` against PGlite + the generated migration.
 * Pins: the round-trip decrypts back to the original client config, the
 * client_secret is NOT stored in cleartext (only ciphertext + iv columns),
 * upsert replaces in place, and a wrong KEK fails closed on read.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { OidcClientConfig, OidcCredentialStore } from '@pinagent/ee-auth';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgOidcCredentialStore } from '../src/db/oidc-credential-store';
import { schema, ssoConnectionCredentials } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const KEK = Buffer.alloc(32, 7).toString('base64url');
const OTHER_KEK = Buffer.alloc(32, 9).toString('base64url');

const config: OidcClientConfig = {
  clientId: 'client-abc',
  clientSecret: 'sh-very-secret',
  redirectUri: 'https://cloud.test/sso/callback',
};

describe('PgOidcCredentialStore', () => {
  let db: ReturnType<typeof drizzle>;
  let store: OidcCredentialStore;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgOidcCredentialStore(db, KEK);
  });

  it('returns null when no credentials are stored', async () => {
    expect(await store.getClientConfig('conn-x')).toBeNull();
  });

  it('round-trips a client config (decrypts back to the original)', async () => {
    await store.setClientConfig('conn-1', config);
    expect(await store.getClientConfig('conn-1')).toEqual(config);
  });

  it('never persists the client_secret in cleartext', async () => {
    await store.setClientConfig('conn-1', config);
    const [row] = await db
      .select()
      .from(ssoConnectionCredentials)
      .where(eq(ssoConnectionCredentials.connectionId, 'conn-1'));
    expect(row?.secretCiphertext).toBeTruthy();
    expect(row?.secretCiphertext).not.toContain('sh-very-secret');
    // No plaintext-secret column exists at all.
    expect(JSON.stringify(row)).not.toContain('sh-very-secret');
  });

  it('upserts in place (no duplicate row)', async () => {
    await store.setClientConfig('conn-1', config);
    await store.setClientConfig('conn-1', { ...config, clientSecret: 'rotated' });
    expect(await store.getClientConfig('conn-1')).toMatchObject({ clientSecret: 'rotated' });
    const rows = await db.select().from(ssoConnectionCredentials);
    expect(rows).toHaveLength(1);
  });

  it('fails closed reading under a different KEK', async () => {
    await store.setClientConfig('conn-1', config);
    const wrong = createPgOidcCredentialStore(db, OTHER_KEK);
    await expect(wrong.getClientConfig('conn-1')).rejects.toThrow();
  });
});

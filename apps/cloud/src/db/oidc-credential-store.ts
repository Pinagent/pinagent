// SPDX-License-Identifier: Elastic-2.0
import type { OidcClientConfig, OidcCredentialStore } from '@pinagent/ee-auth';
import { openSecret, sealSecret } from '@pinagent/ee-auth';
import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { ssoConnectionCredentials } from './schema';

/**
 * Postgres-backed {@link OidcCredentialStore}. The `client_secret` is sealed
 * with the deployment KEK (AES-256-GCM) before it touches the DB and only
 * opened on read — so plaintext secrets never rest in Postgres. Metadata
 * (client_id, redirect_uri) is stored in the clear.
 */

/** Any Drizzle pg database; concrete drivers (neon, pglite) all satisfy this. */
// biome-ignore lint/suspicious/noExplicitAny: accept any driver-specific PgDatabase shape.
export type OidcCredentialDb = PgDatabase<any, any, any>;

export function createPgOidcCredentialStore(
  db: OidcCredentialDb,
  kekBase64Url: string,
): OidcCredentialStore {
  return {
    async getClientConfig(connectionId: string): Promise<OidcClientConfig | null> {
      const [row] = await db
        .select()
        .from(ssoConnectionCredentials)
        .where(eq(ssoConnectionCredentials.connectionId, connectionId))
        .limit(1);
      if (!row) return null;
      const clientSecret = await openSecret(
        { ciphertext: row.secretCiphertext, iv: row.secretIv },
        kekBase64Url,
      );
      return { clientId: row.clientId, clientSecret, redirectUri: row.redirectUri };
    },

    async setClientConfig(connectionId: string, config: OidcClientConfig): Promise<void> {
      const sealed = await sealSecret(config.clientSecret, kekBase64Url);
      await db
        .insert(ssoConnectionCredentials)
        .values({
          connectionId,
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          secretCiphertext: sealed.ciphertext,
          secretIv: sealed.iv,
        })
        .onConflictDoUpdate({
          target: ssoConnectionCredentials.connectionId,
          set: {
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            secretCiphertext: sealed.ciphertext,
            secretIv: sealed.iv,
          },
        });
    },
  };
}

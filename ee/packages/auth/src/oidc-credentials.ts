// SPDX-License-Identifier: Elastic-2.0
import type { OidcClientConfig } from './oidc';

/**
 * Per-connection OIDC client credentials, looked up by connection id. The
 * `client_secret` is encrypted at rest in the Postgres adapter (see
 * `sso-crypto.ts`); this port hands back the *decrypted* config only at the
 * moment of the handshake, so a multi-connection deployment can resolve the
 * right client for whichever IdP a login targets.
 *
 * The in-memory impl holds plaintext — for tests and single-process use.
 */
export interface OidcCredentialStore {
  /** Decrypted client config for a connection, or null if none is stored. */
  getClientConfig(connectionId: string): Promise<OidcClientConfig | null>;
  /** Store (encrypting in the pg adapter) a connection's client config. */
  setClientConfig(connectionId: string, config: OidcClientConfig): Promise<void>;
}

export function createInMemoryOidcCredentialStore(
  seed: Record<string, OidcClientConfig> = {},
): OidcCredentialStore {
  const byId = new Map<string, OidcClientConfig>(Object.entries(seed));
  return {
    async getClientConfig(connectionId) {
      return byId.get(connectionId) ?? null;
    },
    async setClientConfig(connectionId, config) {
      byId.set(connectionId, config);
    },
  };
}

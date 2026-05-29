// SPDX-License-Identifier: Elastic-2.0
import type { OidcClientConfig, OidcCredentialStore, SsoConnection } from '@pinagent/ee-auth';

/**
 * Builds the OIDC provider's `clientFor`. The env-configured connection keeps
 * using its boot-time credentials (single-connection deploys stay zero-config,
 * no KEK needed); every other connection resolves its decrypted client from
 * the credential store. A connection with no client anywhere throws — surfaced
 * as a generic login failure, never leaked to the browser.
 */
export interface OidcClientResolverDeps {
  /** The env-configured connection id whose credentials come from config. */
  configuredConnectionId: string;
  /** Boot-time client config for the configured connection. */
  configuredClient: OidcClientConfig;
  /** Per-connection (encrypted-at-rest) credentials, or null when no KEK is set. */
  credentials: OidcCredentialStore | null;
}

export function createOidcClientResolver(
  deps: OidcClientResolverDeps,
): (connection: SsoConnection) => Promise<OidcClientConfig> {
  return async (connection) => {
    if (connection.id === deps.configuredConnectionId) return deps.configuredClient;
    const stored = await deps.credentials?.getClientConfig(connection.id);
    if (stored) return stored;
    throw new Error(`no OIDC client configured for connection "${connection.id}"`);
  };
}

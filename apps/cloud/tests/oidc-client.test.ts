// SPDX-License-Identifier: Elastic-2.0
/**
 * `createOidcClientResolver` — the `clientFor` the worker hands the OIDC
 * provider. The env-configured connection keeps its boot-time creds (no KEK
 * needed); other connections resolve from the credential store; an unknown
 * connection throws (never a silent wrong-client).
 */
import {
  createInMemoryOidcCredentialStore,
  type OidcClientConfig,
  type SsoConnection,
} from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';
import { createOidcClientResolver } from '../src/oidc-client';

const configuredClient: OidcClientConfig = {
  clientId: 'env-client',
  clientSecret: 'env-secret',
  redirectUri: 'https://cloud.test/sso/callback',
};

const otherClient: OidcClientConfig = {
  clientId: 'acme-client',
  clientSecret: 'acme-secret',
  redirectUri: 'https://cloud.test/sso/callback',
};

function connection(id: string): SsoConnection {
  return {
    id,
    organizationId: 'org',
    protocol: 'oidc',
    issuer: 'https://idp',
    domains: [],
    enabled: true,
  };
}

describe('createOidcClientResolver', () => {
  it('returns the env-configured client for the configured connection (no store needed)', async () => {
    const resolve = createOidcClientResolver({
      configuredConnectionId: 'conn-env',
      configuredClient,
      credentials: null,
    });
    expect(await resolve(connection('conn-env'))).toEqual(configuredClient);
  });

  it('resolves other connections from the credential store', async () => {
    const resolve = createOidcClientResolver({
      configuredConnectionId: 'conn-env',
      configuredClient,
      credentials: createInMemoryOidcCredentialStore({ 'conn-acme': otherClient }),
    });
    expect(await resolve(connection('conn-acme'))).toEqual(otherClient);
  });

  it('throws for an unknown connection (no creds anywhere)', async () => {
    const resolve = createOidcClientResolver({
      configuredConnectionId: 'conn-env',
      configuredClient,
      credentials: createInMemoryOidcCredentialStore(),
    });
    await expect(resolve(connection('conn-missing'))).rejects.toThrow(/no OIDC client/);
  });

  it('throws for a non-configured connection when no store is wired', async () => {
    const resolve = createOidcClientResolver({
      configuredConnectionId: 'conn-env',
      configuredClient,
      credentials: null,
    });
    await expect(resolve(connection('conn-other'))).rejects.toThrow(/no OIDC client/);
  });
});

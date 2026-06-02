// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { loadCloudConfig } from '../src/config';

/** A complete, valid env bag — clone and tweak per case. */
function fullEnv(): Record<string, string> {
  return {
    RELAY_AUTH_SECRET: 'relay-auth',
    PINAGENT_RELAY_PUBLIC_URL: 'wss://relay.example',
    DATABASE_URL: 'postgres://localhost/db',
    USER_TOKEN_SECRET: 'user-token',
    SSO_STATE_SECRET: 'sso-state',
    OIDC_NONCE_SECRET: 'nonce',
    RELAY_INTERNAL_SECRET: 'relay-internal',
    BILLING_INTERNAL_SECRET: 'billing-internal',
    OIDC_CONNECTION_ID: 'conn-1',
    OIDC_ORG_ID: 'org-1',
    OIDC_ISSUER: 'https://idp.example',
    OIDC_CLIENT_ID: 'client-1',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_REDIRECT_URI: 'https://cloud.example/sso/callback',
  };
}

describe('loadCloudConfig — internal-secret split', () => {
  it('reads the billing secret from its OWN env var, distinct from the relay secret', () => {
    const config = loadCloudConfig(fullEnv());
    expect(config.relayInternalSecret).toBe('relay-internal');
    expect(config.billingInternalSecret).toBe('billing-internal');
    // The whole point of the split: the two trust domains must not collapse
    // onto one value at the composition root.
    expect(config.billingInternalSecret).not.toBe(config.relayInternalSecret);
  });

  it('fails the deploy when BILLING_INTERNAL_SECRET is missing', () => {
    const env = fullEnv();
    delete (env as Record<string, string | undefined>).BILLING_INTERNAL_SECRET;
    expect(() => loadCloudConfig(env)).toThrow(/BILLING_INTERNAL_SECRET/);
  });

  it('keeps requiring RELAY_INTERNAL_SECRET independently', () => {
    const env = fullEnv();
    delete (env as Record<string, string | undefined>).RELAY_INTERNAL_SECRET;
    expect(() => loadCloudConfig(env)).toThrow(/RELAY_INTERNAL_SECRET/);
  });
});

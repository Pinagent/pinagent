// SPDX-License-Identifier: Elastic-2.0
import { NotImplementedError } from './errors';
import type { OrganizationId } from './membership';

export type SsoProtocol = 'saml' | 'oidc';

/** A configured identity-provider connection for one organization. */
export interface SsoConnection {
  id: string;
  organizationId: OrganizationId;
  protocol: SsoProtocol;
  /** IdP-issued entity/issuer identifier. */
  issuer: string;
  /** Email domains that route to this connection for IdP discovery. */
  domains: readonly string[];
  enabled: boolean;
}

/** Normalized identity returned by an IdP after a successful assertion. */
export interface SsoProfile {
  connectionId: string;
  /** Stable IdP subject identifier. */
  subject: string;
  email: string;
  displayName: string | null;
  /** Raw IdP group/role claims, mapped to Pinagent roles by org policy. */
  groups: readonly string[];
}

/** The IdP callback payload handed back after the user authenticates. */
export interface SsoCallback {
  /** SAML response or OIDC authorization code, depending on protocol. */
  payload: string;
  /** Opaque value echoed from {@link SsoProvider.authorizationUrl} for CSRF protection. */
  state: string;
}

/** Drives the redirect handshake with an external identity provider. */
export interface SsoProvider {
  /** Build the redirect URL that starts an auth flow for a connection. */
  authorizationUrl(connection: SsoConnection, state: string): Promise<string>;
  /** Validate an IdP callback and return the normalized profile. */
  completeLogin(connection: SsoConnection, callback: SsoCallback): Promise<SsoProfile>;
}

/** Narrowing guard for untrusted protocol strings from config or callbacks. */
export function isSsoProtocol(value: unknown): value is SsoProtocol {
  return value === 'saml' || value === 'oidc';
}

/**
 * Placeholder provider so the cloud app compiles before the SAML/OIDC adapters
 * land. Every method throws {@link NotImplementedError}.
 */
export const unimplementedSsoProvider: SsoProvider = {
  authorizationUrl() {
    throw new NotImplementedError('SsoProvider.authorizationUrl');
  },
  completeLogin() {
    throw new NotImplementedError('SsoProvider.completeLogin');
  },
};

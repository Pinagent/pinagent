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
 * Persistence boundary for an org's configured IdP connections. Replaces the
 * single boot-time connection the login routes used to be handed, so one
 * deployment can serve multiple organizations / IdPs. The hosted control
 * plane provides a Postgres-backed implementation; tests use the in-memory one.
 *
 * This stores connection *metadata* only — client credentials stay with the
 * provider's `clientFor`, keyed by connection id, so secrets never round-trip
 * through this boundary.
 */
export interface SsoConnectionStore {
  /** Fetch a connection by id (enabled or not — the caller decides). */
  get(connectionId: string): Promise<SsoConnection | null>;
  /**
   * Resolve the enabled connection that claims `domain` (case-insensitive),
   * for email-domain IdP discovery on the login-start path. `null` if none.
   */
  findByDomain(domain: string): Promise<SsoConnection | null>;
  /** Every connection configured for an organization. */
  listByOrganization(org: OrganizationId): Promise<SsoConnection[]>;
  /** Create or replace a connection by id. */
  upsert(connection: SsoConnection): Promise<void>;
}

/**
 * In-memory {@link SsoConnectionStore} for tests and single-connection
 * bootstrapping. Seed with the connections that should exist up front.
 */
export function createInMemorySsoConnectionStore(
  seed: readonly SsoConnection[] = [],
): SsoConnectionStore {
  const byId = new Map<string, SsoConnection>(seed.map((c) => [c.id, c]));
  return {
    async get(connectionId) {
      return byId.get(connectionId) ?? null;
    },
    async findByDomain(domain) {
      const needle = domain.trim().toLowerCase();
      if (!needle) return null;
      for (const c of byId.values()) {
        if (c.enabled && c.domains.some((d) => d.toLowerCase() === needle)) return c;
      }
      return null;
    },
    async listByOrganization(org) {
      return [...byId.values()].filter((c) => c.organizationId === org);
    },
    async upsert(connection) {
      byId.set(connection.id, connection);
    },
  };
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

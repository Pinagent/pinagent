// SPDX-License-Identifier: Elastic-2.0
import type { UserId } from './membership';
import type { SsoProfile } from './sso';

/**
 * A provisioned end user — the internal record behind an IdP identity,
 * created just-in-time on first SSO login.
 *
 * `id` equals the IdP subject for now, which is what `OrganizationMembership`
 * is keyed on — so adding this record doesn't disturb existing memberships or
 * the relay token's `userId`. Switching to a synthetic internal id is a later
 * migration that can hide behind this same port.
 */
export interface User {
  id: UserId;
  email: string;
  displayName: string | null;
  /** ISO-8601. Stamped once, on first login. */
  createdAt: string;
  /** ISO-8601. Refreshed on every login. */
  lastLoginAt: string;
}

export interface ProvisionOptions {
  /** Wall-clock (ISO-8601) for `createdAt`/`lastLoginAt` — injected for tests. */
  now?: string;
}

/**
 * Persistence boundary for provisioned users. The SSO callback calls
 * {@link UserStore.provisionFromProfile} just-in-time after a successful
 * handshake; the hosted control plane provides a Postgres adapter, tests use
 * the in-memory one.
 */
export interface UserStore {
  get(id: UserId): Promise<User | null>;
  /**
   * Create or refresh the user behind an authenticated SSO profile. Inserts on
   * first login (stamping `createdAt`); on later logins refreshes
   * `email` / `displayName` / `lastLoginAt` while preserving `createdAt`.
   * Returns the resulting record.
   */
  provisionFromProfile(profile: SsoProfile, options?: ProvisionOptions): Promise<User>;
}

/** Build the {@link User} a profile provisions, given the prior record (if any). */
export function userFromProfile(profile: SsoProfile, previous: User | null, now: string): User {
  return {
    id: profile.subject,
    email: profile.email,
    displayName: profile.displayName,
    createdAt: previous?.createdAt ?? now,
    lastLoginAt: now,
  };
}

/** In-memory {@link UserStore} for tests and single-process use. */
export function createInMemoryUserStore(seed: readonly User[] = []): UserStore {
  const byId = new Map<UserId, User>(seed.map((u) => [u.id, u]));
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async provisionFromProfile(profile, options) {
      const now = options?.now ?? new Date().toISOString();
      const user = userFromProfile(profile, byId.get(profile.subject) ?? null, now);
      byId.set(user.id, user);
      return user;
    },
  };
}

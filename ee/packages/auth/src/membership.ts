// SPDX-License-Identifier: Elastic-2.0
import { NotImplementedError } from './errors';
import type { Role } from './rbac';

export type OrganizationId = string;
export type UserId = string;

/** Lifecycle of a user's membership within an organization. */
export type MembershipStatus = 'invited' | 'active' | 'suspended';

export interface Organization {
  id: OrganizationId;
  /** URL-safe unique handle, e.g. `"acme"`. */
  slug: string;
  displayName: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface OrganizationMembership {
  organizationId: OrganizationId;
  userId: UserId;
  role: Role;
  status: MembershipStatus;
  /** ISO-8601 timestamp the invite was issued. */
  invitedAt: string;
  /** ISO-8601 timestamp the invite was accepted, or `null` while pending. */
  joinedAt: string | null;
}

/** True when a membership grants live access (accepted and not suspended). */
export function isActiveMember(membership: OrganizationMembership): boolean {
  return membership.status === 'active' && membership.joinedAt !== null;
}

/**
 * Persistence boundary for organizations and their members. The hosted relay
 * provides a Postgres-backed implementation; tests use an in-memory fake.
 */
export interface MembershipStore {
  getOrganization(id: OrganizationId): Promise<Organization | null>;
  listMembers(id: OrganizationId): Promise<OrganizationMembership[]>;
  getMembership(org: OrganizationId, user: UserId): Promise<OrganizationMembership | null>;
  /** Every organization the user belongs to (any status), for "my orgs". */
  listMembershipsByUser(user: UserId): Promise<OrganizationMembership[]>;
  upsertMembership(membership: OrganizationMembership): Promise<void>;
  removeMembership(org: OrganizationId, user: UserId): Promise<void>;
}

/**
 * Placeholder store so the cloud app can satisfy its DI graph and boot before
 * the real adapter lands. Every method throws {@link NotImplementedError}.
 */
export const unimplementedMembershipStore: MembershipStore = {
  getOrganization() {
    throw new NotImplementedError('MembershipStore.getOrganization');
  },
  listMembers() {
    throw new NotImplementedError('MembershipStore.listMembers');
  },
  getMembership() {
    throw new NotImplementedError('MembershipStore.getMembership');
  },
  listMembershipsByUser() {
    throw new NotImplementedError('MembershipStore.listMembershipsByUser');
  },
  upsertMembership() {
    throw new NotImplementedError('MembershipStore.upsertMembership');
  },
  removeMembership() {
    throw new NotImplementedError('MembershipStore.removeMembership');
  },
};

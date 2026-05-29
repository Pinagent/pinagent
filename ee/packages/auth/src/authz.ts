// SPDX-License-Identifier: Elastic-2.0
import { MembershipRequiredError } from './errors';
import {
  isActiveMember,
  type MembershipStore,
  type OrganizationId,
  type UserId,
} from './membership';
import type { Principal } from './principal';
import { assertCan, type Permission } from './rbac';

/**
 * Resolve and authorize an organization member — the shared authz primitive
 * behind both relay-session issuance and the admin read endpoints.
 *
 * Verifies the user has an *active* membership in the org and, when
 * `permission` is given, that their role holds it. Returns the resolved
 * {@link Principal}.
 *
 * @throws {MembershipRequiredError} when the user has no active membership.
 * @throws {AccessDeniedError} when the role lacks `permission`.
 */
export async function authorizeOrgMember(
  store: MembershipStore,
  userId: UserId,
  organizationId: OrganizationId,
  permission?: Permission,
): Promise<Principal> {
  const membership = await store.getMembership(organizationId, userId);
  if (!membership || !isActiveMember(membership)) {
    throw new MembershipRequiredError(organizationId, userId);
  }
  const principal: Principal = { userId, organizationId, role: membership.role };
  if (permission) assertCan(principal.role, permission);
  return principal;
}

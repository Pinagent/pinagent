// SPDX-License-Identifier: Elastic-2.0

/**
 * `@pinagent/ee-auth` — SSO, RBAC, and organization membership for Pinagent
 * cloud.
 *
 * This phase establishes the public type surface and the pure RBAC engine.
 * I/O boundaries (SSO handshakes, membership persistence) are expressed as
 * interfaces with `unimplemented*` placeholders, so the cloud app can wire its
 * dependency graph ahead of the real adapters and fail loudly the moment an
 * unimplemented path is exercised.
 */
export const PACKAGE_NAME = '@pinagent/ee-auth';

export { AccessDeniedError, AuthError, NotImplementedError } from './errors';
export {
  isActiveMember,
  type MembershipStatus,
  type MembershipStore,
  type Organization,
  type OrganizationId,
  type OrganizationMembership,
  type UserId,
  unimplementedMembershipStore,
} from './membership';
export { type Principal, principalCan } from './principal';
export {
  assertCan,
  can,
  compareRoles,
  isPermission,
  isRole,
  PERMISSIONS,
  type Permission,
  permissionsForRole,
  ROLES,
  type Role,
} from './rbac';
export {
  isSsoProtocol,
  type SsoCallback,
  type SsoConnection,
  type SsoProfile,
  type SsoProtocol,
  type SsoProvider,
  unimplementedSsoProvider,
} from './sso';

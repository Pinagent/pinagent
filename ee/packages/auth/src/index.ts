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
 *
 * It also ships the concrete relay session-token primitives
 * (`signSessionToken` / `verifySessionToken`) used at the `@pinagent/ee-relay`
 * connection boundary.
 */
export const PACKAGE_NAME = '@pinagent/ee-auth';

export {
  AccessDeniedError,
  AuthError,
  MembershipRequiredError,
  NotImplementedError,
  SsoError,
} from './errors';
export type { IdTokenClaims, IdTokenExpectations, JwkKey, Jwks } from './jwt';
export { verifyIdToken } from './jwt';
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
export {
  createOidcProvider,
  deriveOidcNonce,
  type OidcClientConfig,
  type OidcProviderConfig,
} from './oidc';
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
  type IssuedRelaySession,
  type IssueRelaySessionOptions,
  issueRelaySessionToken,
} from './session-issuer';
export {
  type SessionClaims,
  type SignOptions,
  signSessionToken,
  type VerifyResult,
  verifySessionToken,
} from './session-token';
export {
  isSsoProtocol,
  type SsoCallback,
  type SsoConnection,
  type SsoProfile,
  type SsoProtocol,
  type SsoProvider,
  unimplementedSsoProvider,
} from './sso';
export {
  type CodecFailure,
  nowSeconds,
  signClaims,
  type VerifyOutcome,
  verifyClaims,
} from './token-codec';
export {
  type SignUserTokenOptions,
  signUserToken,
  type UserClaims,
  type VerifyUserResult,
  verifyUserToken,
} from './user-token';

// SPDX-License-Identifier: Elastic-2.0
import type { Permission, Role } from './rbac';

/** Base class for every failure surfaced by the ee-auth package. */
export class AuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Thrown by scaffolded boundaries that already have a defined contract but no
 * concrete adapter yet. Lets the cloud app wire its DI graph and fail loudly
 * the moment an unimplemented path is exercised, rather than at import time.
 */
export class NotImplementedError extends AuthError {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
  }
}

/** Thrown when a principal lacks the permission required for an action. */
export class AccessDeniedError extends AuthError {
  constructor(
    readonly role: Role,
    readonly permission: Permission,
  ) {
    super(`role "${role}" is missing required permission "${permission}"`);
  }
}

/**
 * Thrown when relay-session-token issuance is denied because the user has no
 * active membership in the target organization. `organizationId` / `userId`
 * are typed as plain strings to keep this module free of a cycle through
 * `membership.ts` (which imports from here).
 */
export class MembershipRequiredError extends AuthError {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
  ) {
    super(`user "${userId}" is not an active member of organization "${organizationId}"`);
  }
}

/**
 * Thrown when an SSO login handshake fails — bad token exchange, an
 * ID token that fails signature/issuer/audience/expiry/nonce validation, or a
 * malformed IdP response. The message is intentionally generic at the boundary
 * so failure details aren't leaked to the end user.
 */
export class SsoError extends AuthError {}

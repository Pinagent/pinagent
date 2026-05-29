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

// SPDX-License-Identifier: Elastic-2.0
import { AccessDeniedError } from './errors';

/**
 * Role-based access control for Pinagent cloud.
 *
 * Roles are hierarchical: each role inherits every permission held by the
 * roles beneath it. The matrix below is the single source of truth — the
 * hosted relay and the dashboard both resolve authorization through {@link can}
 * rather than hard-coding role checks at call sites.
 */

/** Organization roles, ordered from least to most privileged. */
export const ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

/** Discrete capabilities that authorization is checked against. */
export const PERMISSIONS = [
  'project:read',
  'project:write',
  'conversation:read',
  'conversation:write',
  'member:invite',
  'member:remove',
  'billing:read',
  'billing:manage',
  'org:settings',
  'org:delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions introduced by each role on top of the role below it. Effective
 * permissions are the cumulative union up the hierarchy — see
 * {@link permissionsForRole}.
 */
const DIRECT_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: ['project:read', 'conversation:read', 'billing:read'],
  member: ['conversation:write'],
  admin: ['project:write', 'member:invite', 'member:remove', 'billing:manage', 'org:settings'],
  owner: ['org:delete'],
};

/** Pre-compute the cumulative permission set for every role once, at load. */
const EFFECTIVE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = (() => {
  const result = {} as Record<Role, ReadonlySet<Permission>>;
  const accumulated = new Set<Permission>();
  for (const role of ROLES) {
    for (const permission of DIRECT_PERMISSIONS[role]) {
      accumulated.add(permission);
    }
    result[role] = new Set(accumulated);
  }
  return result;
})();

/** Every permission a role holds, including those inherited from lower roles. */
export function permissionsForRole(role: Role): ReadonlySet<Permission> {
  return EFFECTIVE_PERMISSIONS[role];
}

/** True when `role` is allowed to perform an action requiring `permission`. */
export function can(role: Role, permission: Permission): boolean {
  return EFFECTIVE_PERMISSIONS[role].has(permission);
}

/** Assert that `role` may perform `permission`; throws {@link AccessDeniedError}. */
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AccessDeniedError(role, permission);
  }
}

/**
 * Compare two roles by privilege. Returns a negative number when `a` is less
 * privileged than `b`, positive when more, and zero when equal — suitable for
 * use as an `Array#sort` comparator.
 */
export function compareRoles(a: Role, b: Role): number {
  return ROLES.indexOf(a) - ROLES.indexOf(b);
}

/** Narrowing guard for untrusted role strings (e.g. JWT or IdP claims). */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Narrowing guard for untrusted permission strings. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

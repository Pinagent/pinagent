// SPDX-License-Identifier: Elastic-2.0
import type { OrganizationId, UserId } from './membership';
import { can, type Permission, type Role } from './rbac';

/** The authenticated actor for a single request, scoped to one organization. */
export interface Principal {
  userId: UserId;
  organizationId: OrganizationId;
  role: Role;
}

/** True when this principal holds `permission` within its organization. */
export function principalCan(principal: Principal, permission: Permission): boolean {
  return can(principal.role, permission);
}

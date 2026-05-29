// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { AccessDeniedError } from '../src/errors';
import {
  assertCan,
  can,
  compareRoles,
  isPermission,
  isRole,
  permissionsForRole,
  ROLES,
} from '../src/rbac';

describe('can', () => {
  it('grants a role its own permissions', () => {
    expect(can('viewer', 'project:read')).toBe(true);
    expect(can('member', 'conversation:write')).toBe(true);
    expect(can('admin', 'member:invite')).toBe(true);
    expect(can('owner', 'org:delete')).toBe(true);
  });

  it('inherits permissions from lower roles', () => {
    // member inherits everything a viewer can do.
    expect(can('member', 'project:read')).toBe(true);
    // owner inherits the full admin set.
    expect(can('owner', 'billing:manage')).toBe(true);
    expect(can('owner', 'project:read')).toBe(true);
  });

  it('does not leak higher-role permissions downward', () => {
    expect(can('viewer', 'conversation:write')).toBe(false);
    expect(can('member', 'member:invite')).toBe(false);
    expect(can('admin', 'org:delete')).toBe(false);
  });
});

describe('permissionsForRole', () => {
  it('returns a strictly growing set up the hierarchy', () => {
    let previous = 0;
    for (const role of ROLES) {
      const size = permissionsForRole(role).size;
      expect(size).toBeGreaterThan(previous);
      previous = size;
    }
  });

  it('gives the owner every defined permission', () => {
    expect(permissionsForRole('owner').has('org:delete')).toBe(true);
    expect(permissionsForRole('owner').has('project:read')).toBe(true);
  });
});

describe('assertCan', () => {
  it('returns silently when the role is allowed', () => {
    expect(() => assertCan('owner', 'org:delete')).not.toThrow();
  });

  it('throws AccessDeniedError carrying the role and permission', () => {
    try {
      assertCan('viewer', 'org:delete');
      expect.unreachable('assertCan should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect((error as AccessDeniedError).role).toBe('viewer');
      expect((error as AccessDeniedError).permission).toBe('org:delete');
    }
  });
});

describe('compareRoles', () => {
  it('orders roles from least to most privileged', () => {
    expect(compareRoles('viewer', 'owner')).toBeLessThan(0);
    expect(compareRoles('owner', 'viewer')).toBeGreaterThan(0);
    expect(compareRoles('admin', 'admin')).toBe(0);
  });
});

describe('isRole / isPermission', () => {
  it('accepts known values and rejects unknown ones', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isPermission('project:read')).toBe(true);
    expect(isPermission('project:nuke')).toBe(false);
  });
});

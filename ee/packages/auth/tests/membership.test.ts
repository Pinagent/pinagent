// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { NotImplementedError } from '../src/errors';
import {
  isActiveMember,
  type OrganizationMembership,
  unimplementedMembershipStore,
} from '../src/membership';
import { isSsoProtocol, unimplementedSsoProvider } from '../src/sso';

function membership(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'member',
    status: 'active',
    invitedAt: '2026-01-01T00:00:00.000Z',
    joinedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('isActiveMember', () => {
  it('is true for an accepted, active membership', () => {
    expect(isActiveMember(membership())).toBe(true);
  });

  it('is false while the invite is still pending', () => {
    expect(isActiveMember(membership({ status: 'invited', joinedAt: null }))).toBe(false);
  });

  it('is false when suspended', () => {
    expect(isActiveMember(membership({ status: 'suspended' }))).toBe(false);
  });
});

describe('isSsoProtocol', () => {
  it('recognizes the supported protocols only', () => {
    expect(isSsoProtocol('saml')).toBe(true);
    expect(isSsoProtocol('oidc')).toBe(true);
    expect(isSsoProtocol('ldap')).toBe(false);
    expect(isSsoProtocol(null)).toBe(false);
  });
});

describe('unimplemented placeholders', () => {
  it('throw NotImplementedError when exercised', () => {
    expect(() => unimplementedMembershipStore.getOrganization('org_1')).toThrow(
      NotImplementedError,
    );
    expect(() =>
      unimplementedSsoProvider.authorizationUrl(
        {
          id: 'conn_1',
          organizationId: 'org_1',
          protocol: 'oidc',
          issuer: 'https://idp.example.com',
          domains: ['example.com'],
          enabled: true,
        },
        'state',
      ),
    ).toThrow(NotImplementedError);
  });
});

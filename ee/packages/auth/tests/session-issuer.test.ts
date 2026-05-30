// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { AccessDeniedError, MembershipRequiredError } from '../src/errors';
import type { MembershipStatus, MembershipStore, OrganizationMembership } from '../src/membership';
import type { Role } from '../src/rbac';
import { issueRelaySessionToken } from '../src/session-issuer';
import { verifySessionToken } from '../src/session-token';

const SECRET = 'test-secret-do-not-use-in-prod';

/** In-memory MembershipStore holding a single membership for the tests. */
function storeWith(membership: OrganizationMembership | null): MembershipStore {
  return {
    async getMembership(org, user) {
      return membership && membership.organizationId === org && membership.userId === user
        ? membership
        : null;
    },
    async getOrganization() {
      return null;
    },
    async listMembers() {
      return membership ? [membership] : [];
    },
    async listMembershipsByUser() {
      return membership ? [membership] : [];
    },
    async upsertMembership() {},
    async removeMembership() {},
  };
}

function membership(
  role: Role,
  status: MembershipStatus,
  joinedAt: string | null = '2026-01-01T00:00:00Z',
): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId: 'user-1',
    role,
    status,
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt,
  };
}

const base = {
  userId: 'user-1',
  organizationId: 'acme',
  sessionId: 'sess-1',
  secret: SECRET,
} as const;

describe('issueRelaySessionToken', () => {
  it('issues a verifiable token for an active member', async () => {
    const { token, principal } = await issueRelaySessionToken({
      ...base,
      store: storeWith(membership('member', 'active')),
    });

    expect(principal).toEqual({ userId: 'user-1', organizationId: 'acme', role: 'member' });

    const result = await verifySessionToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Org is the tenant; the member's role rides along in the claims.
      expect(result.claims.tenantId).toBe('acme');
      expect(result.claims.sessionId).toBe('sess-1');
      expect(result.claims.role).toBe('member');
    }
  });

  it('rejects a non-member', async () => {
    await expect(
      issueRelaySessionToken({ ...base, store: storeWith(null) }),
    ).rejects.toBeInstanceOf(MembershipRequiredError);
  });

  it.each<MembershipStatus>([
    'invited',
    'suspended',
  ])('rejects a %s (non-active) membership', async (status) => {
    await expect(
      issueRelaySessionToken({ ...base, store: storeWith(membership('admin', status)) }),
    ).rejects.toBeInstanceOf(MembershipRequiredError);
  });

  it('rejects an accepted-then-unjoined membership (no joinedAt)', async () => {
    await expect(
      issueRelaySessionToken({
        ...base,
        store: storeWith(membership('member', 'active', null)),
      }),
    ).rejects.toBeInstanceOf(MembershipRequiredError);
  });

  it('honours requirePermission when the role is sufficient', async () => {
    const { principal } = await issueRelaySessionToken({
      ...base,
      store: storeWith(membership('member', 'active')),
      requirePermission: 'conversation:write',
    });
    expect(principal.role).toBe('member');
  });

  it('denies issuance when the role lacks requirePermission', async () => {
    await expect(
      issueRelaySessionToken({
        ...base,
        store: storeWith(membership('viewer', 'active')),
        requirePermission: 'conversation:write',
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

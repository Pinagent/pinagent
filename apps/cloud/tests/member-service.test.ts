// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership, Role, User } from '@pinagent/ee-auth';
import {
  createInMemoryInvitationStore,
  createInMemoryUserStore,
  type InvitationStore,
} from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';
import { handleInvitations, type MemberServiceDeps } from '../src/member-service';

const NOW = '2026-05-30T00:00:00.000Z';

function member(userId: string, role: Role): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId,
    role,
    status: 'active',
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt: '2026-01-02T00:00:00Z',
  };
}

/** Membership store: an admin + a viewer in `acme`; captures upserts. */
function membershipStore(): MembershipStore & { upserts: OrganizationMembership[] } {
  const members = [member('u-admin', 'admin'), member('u-viewer', 'viewer')];
  const upserts: OrganizationMembership[] = [];
  return {
    upserts,
    async getMembership(org, user) {
      return org === 'acme' ? (members.find((m) => m.userId === user) ?? null) : null;
    },
    async getOrganization() {
      return null;
    },
    async listMembers() {
      return members;
    },
    async listMembershipsByUser() {
      return [];
    },
    async upsertMembership(m) {
      upserts.push(m);
    },
    async removeMembership() {},
  };
}

function deps(
  asUserId: string | null,
  opts: {
    users?: User[];
    invitations?: InvitationStore;
    store?: ReturnType<typeof membershipStore>;
  } = {},
): MemberServiceDeps & { store: ReturnType<typeof membershipStore>; invitations: InvitationStore } {
  const store = opts.store ?? membershipStore();
  const invitations = opts.invitations ?? createInMemoryInvitationStore();
  return {
    store,
    users: createInMemoryUserStore(opts.users ?? []),
    invitations,
    authenticate: async () => (asUserId ? { userId: asUserId } : null),
    now: () => NOW,
  };
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://cloud.test${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function user(id: string, email: string): User {
  return { id, email, displayName: null, createdAt: NOW, lastLoginAt: NOW };
}

describe('POST /invitations (invite)', () => {
  it('stages a pending invitation when the email is unknown', async () => {
    const d = deps('u-admin');
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'New@Acme.com', role: 'member' }),
      d,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitation?: { email: string; role: string } };
    expect(body.invitation).toMatchObject({ email: 'new@acme.com', role: 'member' });
    // persisted + no membership granted yet
    expect(await d.invitations.get('acme', 'new@acme.com')).not.toBeNull();
    expect(d.store.upserts).toHaveLength(0);
  });

  it('grants a membership immediately when exactly one user matches the email', async () => {
    const d = deps('u-admin', { users: [user('usr_bob', 'bob@acme.com')] });
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'bob@acme.com', role: 'admin' }),
      d,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { membership?: OrganizationMembership };
    expect(body.membership).toMatchObject({ userId: 'usr_bob', role: 'admin', status: 'active' });
    expect(d.store.upserts).toEqual([
      {
        organizationId: 'acme',
        userId: 'usr_bob',
        role: 'admin',
        status: 'active',
        invitedAt: NOW,
        joinedAt: NOW,
      },
    ]);
    // no pending invitation when granted directly
    expect(await d.invitations.get('acme', 'bob@acme.com')).toBeNull();
  });

  it('stages (not grants) when the email is ambiguous across users', async () => {
    const d = deps('u-admin', {
      users: [user('usr_1', 'dup@acme.com'), user('usr_2', 'dup@acme.com')],
    });
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'dup@acme.com', role: 'member' }),
      d,
    );
    expect(res.status).toBe(200);
    expect(d.store.upserts).toHaveLength(0);
    expect(await d.invitations.get('acme', 'dup@acme.com')).not.toBeNull();
  });

  it('403s for a viewer (member:invite is admin+)', async () => {
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'x@acme.com', role: 'member' }),
      deps('u-viewer'),
    );
    expect(res.status).toBe(403);
  });

  it('400s on a bad role or missing email', async () => {
    expect(
      (
        await handleInvitations(
          req('POST', '/invitations?organizationId=acme', { email: 'x@acme.com', role: 'super' }),
          deps('u-admin'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleInvitations(
          req('POST', '/invitations?organizationId=acme', { role: 'member' }),
          deps('u-admin'),
        )
      ).status,
    ).toBe(400);
  });
});

describe('GET / DELETE /invitations', () => {
  it('lists pending invitations for an admin; 403 for a viewer', async () => {
    const invitations = createInMemoryInvitationStore([
      {
        organizationId: 'acme',
        email: 'p@acme.com',
        role: 'member',
        invitedAt: NOW,
        invitedByUserId: 'u-admin',
      },
    ]);
    const list = await handleInvitations(
      req('GET', '/invitations?organizationId=acme'),
      deps('u-admin', { invitations }),
    );
    expect(list.status).toBe(200);
    expect(((await list.json()) as { invitations: unknown[] }).invitations).toHaveLength(1);

    const viewer = await handleInvitations(
      req('GET', '/invitations?organizationId=acme'),
      deps('u-viewer', { invitations }),
    );
    expect(viewer.status).toBe(403);
  });

  it('revokes a pending invitation (member:remove)', async () => {
    const invitations = createInMemoryInvitationStore([
      {
        organizationId: 'acme',
        email: 'p@acme.com',
        role: 'member',
        invitedAt: NOW,
        invitedByUserId: null,
      },
    ]);
    const d = deps('u-admin', { invitations });
    const res = await handleInvitations(
      req('DELETE', '/invitations?organizationId=acme&email=P@acme.com'),
      d,
    );
    expect(res.status).toBe(200);
    expect(await invitations.get('acme', 'p@acme.com')).toBeNull();
  });

  it('401s unauthenticated; 400 without org', async () => {
    expect(
      (await handleInvitations(req('GET', '/invitations?organizationId=acme'), deps(null))).status,
    ).toBe(401);
    expect((await handleInvitations(req('GET', '/invitations'), deps('u-admin'))).status).toBe(400);
  });
});

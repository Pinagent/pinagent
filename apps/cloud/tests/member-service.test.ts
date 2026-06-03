// SPDX-License-Identifier: Elastic-2.0
import type { MembershipStore, OrganizationMembership, Role, User } from '@pinagent/ee-auth';
import {
  createInMemoryInvitationStore,
  createInMemoryUserStore,
  type InvitationStore,
} from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';
import {
  handleInvitations,
  handleMemberWrite,
  type MemberServiceDeps,
} from '../src/member-service';

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

/** A membership store over an explicit member list (e.g. to seed an owner). */
function membershipStoreWith(
  members: OrganizationMembership[],
): MembershipStore & { upserts: OrganizationMembership[] } {
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
    email?: MemberServiceDeps['email'];
  } = {},
): MemberServiceDeps & { store: ReturnType<typeof membershipStore>; invitations: InvitationStore } {
  const store = opts.store ?? membershipStore();
  const invitations = opts.invitations ?? createInMemoryInvitationStore();
  return {
    store,
    users: createInMemoryUserStore(opts.users ?? []),
    invitations,
    authenticate: async () => (asUserId ? { userId: asUserId } : null),
    email: opts.email,
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

  it('403s when an admin tries to invite an owner (owner-gated) — no escalation', async () => {
    // Staged path (unknown email) and immediate-grant path (known email) must
    // both be gated; check both leave no side effects.
    const staged = deps('u-admin');
    const stagedRes = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'new@acme.com', role: 'owner' }),
      staged,
    );
    expect(stagedRes.status).toBe(403);
    expect(await staged.invitations.get('acme', 'new@acme.com')).toBeNull();

    const grant = deps('u-admin', { users: [user('usr_bob', 'bob@acme.com')] });
    const grantRes = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'bob@acme.com', role: 'owner' }),
      grant,
    );
    expect(grantRes.status).toBe(403);
    expect(grant.store.upserts).toHaveLength(0);
  });

  it('lets an owner invite an owner', async () => {
    const d = deps('u-owner', { store: membershipStoreWith([member('u-owner', 'owner')]) });
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'new@acme.com', role: 'owner' }),
      d,
    );
    expect(res.status).toBe(200);
    expect(await d.invitations.get('acme', 'new@acme.com')).not.toBeNull();
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

  it('400s on a malformed email (stricter than just containing @)', async () => {
    for (const email of [
      'a@b',
      'x@y@z.com',
      'no-at.com',
      '@acme.com',
      'bob@acme',
      'a b@acme.com',
    ]) {
      const res = await handleInvitations(
        req('POST', '/invitations?organizationId=acme', { email, role: 'member' }),
        deps('u-admin'),
      );
      expect(res.status, `should reject "${email}"`).toBe(400);
    }
  });
});

describe('POST /invitations — invitee notification (best-effort, opt-in)', () => {
  type Sent = { to: string; organizationName: string; role: string; inviterName: string | null };

  function recordingEmail(impl?: () => Promise<void>): {
    email: NonNullable<MemberServiceDeps['email']>;
    sent: Sent[];
  } {
    const sent: Sent[] = [];
    return {
      sent,
      email: {
        async sendInvitation(input) {
          sent.push(input);
          if (impl) await impl();
        },
      },
    };
  }

  it('notifies the invitee when staging a pending invitation', async () => {
    const { email, sent } = recordingEmail();
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'New@Acme.com', role: 'member' }),
      deps('u-admin', { email }),
    );
    expect(res.status).toBe(200);
    expect(sent).toEqual([
      // org display name falls back to the id (stub getOrganization → null);
      // inviter name is null (no user record for u-admin).
      { to: 'new@acme.com', organizationName: 'acme', role: 'member', inviterName: null },
    ]);
  });

  it('notifies the invitee on an immediate grant too', async () => {
    const { email, sent } = recordingEmail();
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'bob@acme.com', role: 'admin' }),
      deps('u-admin', { email, users: [user('usr_bob', 'bob@acme.com')] }),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'bob@acme.com', role: 'admin' });
  });

  it('still succeeds when the notifier throws (best-effort)', async () => {
    const { email } = recordingEmail(async () => {
      throw new Error('resend down');
    });
    const res = await handleInvitations(
      req('POST', '/invitations?organizationId=acme', { email: 'x@acme.com', role: 'member' }),
      deps('u-admin', { email }),
    );
    expect(res.status).toBe(200);
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

/** Flexible roster (incl. owners) that captures upserts + removes. */
function roster(members: OrganizationMembership[]) {
  const list = [...members];
  const upserts: OrganizationMembership[] = [];
  const removes: Array<[string, string]> = [];
  const store: MembershipStore = {
    async getMembership(org, user) {
      return org === 'acme' ? (list.find((m) => m.userId === user) ?? null) : null;
    },
    async getOrganization() {
      return null;
    },
    async listMembers() {
      return list;
    },
    async listMembershipsByUser() {
      return [];
    },
    async upsertMembership(m) {
      upserts.push(m);
      const i = list.findIndex((x) => x.userId === m.userId);
      if (i >= 0) list[i] = m;
      else list.push(m);
    },
    async removeMembership(org, user) {
      removes.push([org, user]);
      const i = list.findIndex((x) => x.userId === user);
      if (i >= 0) list.splice(i, 1);
    },
  };
  return { store, upserts, removes };
}

function mgmtDeps(
  asUserId: string,
  members: OrganizationMembership[],
  opts: { email?: MemberServiceDeps['email']; users?: User[] } = {},
): MemberServiceDeps & {
  upserts: OrganizationMembership[];
  removes: Array<[string, string]>;
} {
  const { store, upserts, removes } = roster(members);
  return {
    store,
    users: createInMemoryUserStore(opts.users ?? []),
    invitations: createInMemoryInvitationStore(),
    authenticate: async () => ({ userId: asUserId }),
    email: opts.email,
    now: () => NOW,
    upserts,
    removes,
  };
}

const TEAM = () => [
  member('u-owner', 'owner'),
  member('u-admin', 'admin'),
  member('u-member', 'member'),
  member('u-viewer', 'viewer'),
];

describe('DELETE /members (remove)', () => {
  it('an admin removes a regular member', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-member'),
      d,
    );
    expect(res.status).toBe(200);
    expect(d.removes).toEqual([['acme', 'u-member']]);
  });

  it('403s for a viewer (member:remove required)', async () => {
    const d = mgmtDeps('u-viewer', TEAM());
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-member'),
      d,
    );
    expect(res.status).toBe(403);
    expect(d.removes).toHaveLength(0);
  });

  it('403s when an admin tries to remove an owner', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-owner'),
      d,
    );
    expect(res.status).toBe(403);
  });

  it('an owner removes another owner when more than one exists', async () => {
    const d = mgmtDeps('u-owner', [member('u-owner', 'owner'), member('u-owner2', 'owner')]);
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-owner2'),
      d,
    );
    expect(res.status).toBe(200);
  });

  it('409s removing the last owner', async () => {
    const d = mgmtDeps('u-owner', [member('u-owner', 'owner'), member('u-admin', 'admin')]);
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-owner'),
      d,
    );
    expect(res.status).toBe(409);
    expect(d.removes).toHaveLength(0);
  });

  it('404s for an unknown member; 400 without userId', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    expect(
      (await handleMemberWrite(req('DELETE', '/members?organizationId=acme&userId=ghost'), d))
        .status,
    ).toBe(404);
    expect((await handleMemberWrite(req('DELETE', '/members?organizationId=acme'), d)).status).toBe(
      400,
    );
  });
});

describe('PATCH /members (change role)', () => {
  it('an admin changes a regular member’s role', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    const res = await handleMemberWrite(
      req('PATCH', '/members?organizationId=acme&userId=u-member', { role: 'admin' }),
      d,
    );
    expect(res.status).toBe(200);
    expect(d.upserts).toEqual([expect.objectContaining({ userId: 'u-member', role: 'admin' })]);
  });

  it('403s when an admin promotes someone to owner', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    const res = await handleMemberWrite(
      req('PATCH', '/members?organizationId=acme&userId=u-member', { role: 'owner' }),
      d,
    );
    expect(res.status).toBe(403);
    expect(d.upserts).toHaveLength(0);
  });

  it('an owner promotes a member to owner', async () => {
    const d = mgmtDeps('u-owner', TEAM());
    const res = await handleMemberWrite(
      req('PATCH', '/members?organizationId=acme&userId=u-member', { role: 'owner' }),
      d,
    );
    expect(res.status).toBe(200);
  });

  it('403s when an admin changes an owner’s role', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    const res = await handleMemberWrite(
      req('PATCH', '/members?organizationId=acme&userId=u-owner', { role: 'admin' }),
      d,
    );
    expect(res.status).toBe(403);
  });

  it('409s when an owner demotes the last owner', async () => {
    const d = mgmtDeps('u-owner', [member('u-owner', 'owner'), member('u-admin', 'admin')]);
    const res = await handleMemberWrite(
      req('PATCH', '/members?organizationId=acme&userId=u-owner', { role: 'admin' }),
      d,
    );
    expect(res.status).toBe(409);
  });

  it('400s on a bad role; 404s for an unknown member', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    expect(
      (
        await handleMemberWrite(
          req('PATCH', '/members?organizationId=acme&userId=u-member', { role: 'super' }),
          d,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleMemberWrite(
          req('PATCH', '/members?organizationId=acme&userId=ghost', { role: 'member' }),
          d,
        )
      ).status,
    ).toBe(404);
  });

  it('405s on an unsupported method', async () => {
    const d = mgmtDeps('u-admin', TEAM());
    expect((await handleMemberWrite(req('POST', '/members?organizationId=acme'), d)).status).toBe(
      405,
    );
  });
});

describe('member-change notifications (best-effort, opt-in)', () => {
  type Removed = { to: string; organizationName: string; removedByName: string | null };
  type RoleChanged = {
    to: string;
    organizationName: string;
    role: string;
    changedByName: string | null;
  };

  function recordingEmail(): {
    email: NonNullable<MemberServiceDeps['email']>;
    removed: Removed[];
    roleChanged: RoleChanged[];
  } {
    const removed: Removed[] = [];
    const roleChanged: RoleChanged[] = [];
    return {
      removed,
      roleChanged,
      email: {
        async sendInvitation() {},
        async sendMemberRemoved(input) {
          removed.push(input);
        },
        async sendRoleChanged(input) {
          roleChanged.push(input);
        },
      },
    };
  }

  const PEOPLE = [user('u-admin', 'admin@acme.com'), user('u-member', 'member@acme.com')];

  it('emails the removed member (resolving their address + the remover)', async () => {
    const rec = recordingEmail();
    const d = mgmtDeps('u-admin', TEAM(), { email: rec.email, users: PEOPLE });
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-member'),
      d,
    );
    expect(res.status).toBe(200);
    expect(rec.removed).toEqual([
      // org name falls back to the id (roster getOrganization → null); remover
      // has no displayName, so it uses their email.
      { to: 'member@acme.com', organizationName: 'acme', removedByName: 'admin@acme.com' },
    ]);
  });

  it('emails the member whose role changed, with the new role', async () => {
    const rec = recordingEmail();
    const d = mgmtDeps('u-admin', TEAM(), { email: rec.email, users: PEOPLE });
    const res = await handleMemberWrite(
      req('PATCH', '/members?organizationId=acme&userId=u-member', { role: 'admin' }),
      d,
    );
    expect(res.status).toBe(200);
    expect(rec.roleChanged).toEqual([
      {
        to: 'member@acme.com',
        organizationName: 'acme',
        role: 'admin',
        changedByName: 'admin@acme.com',
      },
    ]);
  });

  it('skips the email when the target has no address on record', async () => {
    const rec = recordingEmail();
    // only the actor is seeded; the target (u-member) has no user row → no email
    const d = mgmtDeps('u-admin', TEAM(), {
      email: rec.email,
      users: [user('u-admin', 'a@acme.com')],
    });
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-member'),
      d,
    );
    expect(res.status).toBe(200);
    expect(rec.removed).toHaveLength(0);
  });

  it('still succeeds (200) when the notifier throws', async () => {
    const email: NonNullable<MemberServiceDeps['email']> = {
      async sendInvitation() {},
      async sendMemberRemoved() {
        throw new Error('resend down');
      },
      async sendRoleChanged() {},
    };
    const d = mgmtDeps('u-admin', TEAM(), { email, users: PEOPLE });
    const res = await handleMemberWrite(
      req('DELETE', '/members?organizationId=acme&userId=u-member'),
      d,
    );
    expect(res.status).toBe(200);
  });
});

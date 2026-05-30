// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type {
  MembershipStatus,
  MembershipStore,
  OrganizationMembership,
  Role,
} from '@pinagent/ee-auth';
import { isActiveMember } from '@pinagent/ee-auth';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgMembershipStore } from '../src/db/membership-store';
import { organizations, schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

function membership(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    organizationId: 'acme',
    userId: 'user-1',
    role: 'member',
    status: 'active',
    invitedAt: '2026-01-01T00:00:00Z',
    joinedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

// Real Postgres semantics in-process via PGlite + the generated migration —
// no external database, but exercises the actual SQL the adapter emits.
describe('PgMembershipStore', () => {
  let db: ReturnType<typeof drizzle>;
  let store: MembershipStore;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgMembershipStore(db);
  });

  it('returns null for a membership that does not exist', async () => {
    expect(await store.getMembership('acme', 'nobody')).toBeNull();
  });

  it('round-trips an upserted membership', async () => {
    const m = membership();
    await store.upsertMembership(m);
    expect(await store.getMembership('acme', 'user-1')).toEqual(m);
  });

  it('persists a null joinedAt (invited member)', async () => {
    const invited = membership({ status: 'invited', joinedAt: null });
    await store.upsertMembership(invited);
    const read = await store.getMembership('acme', 'user-1');
    expect(read?.joinedAt).toBeNull();
    expect(isActiveMember(read as OrganizationMembership)).toBe(false);
  });

  it('updates role and status on conflict (upsert is idempotent by key)', async () => {
    await store.upsertMembership(membership({ role: 'viewer', status: 'invited', joinedAt: null }));
    await store.upsertMembership(membership({ role: 'admin', status: 'active' }));

    const members = await store.listMembers('acme');
    expect(members).toHaveLength(1); // updated in place, not duplicated
    expect(members[0]).toMatchObject({
      role: 'admin' as Role,
      status: 'active' as MembershipStatus,
    });
  });

  it('lists members scoped to one organization', async () => {
    await store.upsertMembership(membership({ userId: 'user-1' }));
    await store.upsertMembership(membership({ userId: 'user-2', role: 'admin' }));
    await store.upsertMembership(membership({ organizationId: 'other', userId: 'user-3' }));

    const members = await store.listMembers('acme');
    expect(members.map((m) => m.userId).sort()).toEqual(['user-1', 'user-2']);
  });

  it('lists a user’s memberships scoped to that user, across orgs', async () => {
    await store.upsertMembership(membership({ organizationId: 'acme', userId: 'user-1' }));
    await store.upsertMembership(membership({ organizationId: 'other', userId: 'user-1' }));
    await store.upsertMembership(membership({ organizationId: 'acme', userId: 'user-2' }));

    const mine = await store.listMembershipsByUser('user-1');
    expect(mine.map((m) => m.organizationId).sort()).toEqual(['acme', 'other']);
    expect(await store.listMembershipsByUser('nobody')).toEqual([]);
  });

  it('removes a membership', async () => {
    await store.upsertMembership(membership());
    await store.removeMembership('acme', 'user-1');
    expect(await store.getMembership('acme', 'user-1')).toBeNull();
  });

  it('reads an organization row', async () => {
    expect(await store.getOrganization('acme')).toBeNull();
    await db.insert(organizations).values({
      id: 'acme',
      slug: 'acme',
      displayName: 'Acme, Inc.',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(await store.getOrganization('acme')).toMatchObject({
      slug: 'acme',
      displayName: 'Acme, Inc.',
    });
  });
});

// SPDX-License-Identifier: Elastic-2.0
/**
 * `createPgInvitationStore` against PGlite + the generated migration — real
 * Postgres semantics in-process. Pins: email normalized + matched
 * case-insensitively, `(org, email)` PK so re-invite overwrites, list scoped
 * per org, remove works.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Invitation, InvitationStore } from '@pinagent/ee-auth';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgInvitationStore } from '../src/db/invitation-store';
import { schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

function invite(overrides: Partial<Invitation> = {}): Invitation {
  return {
    organizationId: 'acme',
    email: 'Bob@Acme.com',
    role: 'member',
    invitedAt: '2026-01-01T00:00:00Z',
    invitedByUserId: 'usr_admin',
    ...overrides,
  };
}

describe('PgInvitationStore', () => {
  let store: InvitationStore;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgInvitationStore(db);
  });

  it('normalizes email on write and matches case-insensitively', async () => {
    await store.upsert(invite());
    expect(await store.get('acme', '  BOB@ACME.COM ')).toMatchObject({
      email: 'bob@acme.com',
      role: 'member',
      invitedByUserId: 'usr_admin',
    });
    expect(await store.get('other', 'bob@acme.com')).toBeNull();
  });

  it('re-invite overwrites the role in place (PK on org+email, no duplicate)', async () => {
    await store.upsert(invite({ role: 'member' }));
    await store.upsert(invite({ role: 'admin' }));
    const list = await store.listByOrg('acme');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: 'bob@acme.com', role: 'admin' });
  });

  it('lists scoped to the org and removes', async () => {
    await store.upsert(invite({ email: 'a@acme.com' }));
    await store.upsert(invite({ email: 'b@acme.com' }));
    await store.upsert(invite({ organizationId: 'other', email: 'c@other.com' }));
    expect((await store.listByOrg('acme')).map((i) => i.email).sort()).toEqual([
      'a@acme.com',
      'b@acme.com',
    ]);
    await store.remove('acme', 'A@ACME.COM');
    expect(await store.get('acme', 'a@acme.com')).toBeNull();
  });

  it('persists a null invitedByUserId', async () => {
    await store.upsert(invite({ email: 'x@acme.com', invitedByUserId: null }));
    expect((await store.get('acme', 'x@acme.com'))?.invitedByUserId).toBeNull();
  });
});

// SPDX-License-Identifier: Elastic-2.0
/**
 * `createPgUserStore` against PGlite + the generated migration — real
 * Postgres semantics in-process. Pins the synthetic-id model: the user id is
 * minted (not the IdP subject), `(connectionId, subject)` resolves to it via
 * `sso_identities`, and re-login refreshes in place preserving id + createdAt.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { SsoProfile, UserStore } from '@pinagent/ee-auth';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { schema, ssoIdentities, users } from '../src/db/schema';
import { createPgUserStore } from '../src/db/user-store';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

function profile(overrides: Partial<SsoProfile> = {}): SsoProfile {
  return {
    connectionId: 'conn-1',
    subject: 'idp-user-9',
    email: 'bob@acme.com',
    displayName: 'Bob',
    groups: [],
    ...overrides,
  };
}

/** Deterministic id generator for assertions: usr_1, usr_2, … */
function sequentialIds() {
  let n = 0;
  return () => `usr_${++n}`;
}

describe('PgUserStore', () => {
  let db: ReturnType<typeof drizzle>;
  let store: UserStore;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgUserStore(db, { generateId: sequentialIds() });
  });

  it('returns null for an unknown user', async () => {
    expect(await store.get('nobody')).toBeNull();
  });

  it('mints a synthetic id on first login and records the identity mapping', async () => {
    const created = await store.provisionFromProfile(profile(), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(created).toEqual({
      id: 'usr_1',
      email: 'bob@acme.com',
      displayName: 'Bob',
      createdAt: '2026-05-29T10:00:00.000Z',
      lastLoginAt: '2026-05-29T10:00:00.000Z',
    });
    expect(created.id).not.toBe('idp-user-9'); // decoupled from the subject
    expect(await store.get('usr_1')).toEqual(created);
    // exactly one identity row mapping (conn-1, idp-user-9) → usr_1
    expect(await db.select().from(ssoIdentities)).toEqual([
      { connectionId: 'conn-1', subject: 'idp-user-9', userId: 'usr_1' },
    ]);
  });

  it('resolves the same identity to the same user on re-login (no duplicate rows)', async () => {
    await store.provisionFromProfile(profile(), { now: '2026-01-01T00:00:00.000Z' });
    const updated = await store.provisionFromProfile(
      profile({ email: 'bob@new.com', displayName: 'Bobby' }),
      { now: '2026-05-29T10:00:00.000Z' },
    );
    expect(updated.id).toBe('usr_1'); // same identity → same user, no new id
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(ssoIdentities)).toHaveLength(1);
    expect(await store.get('usr_1')).toMatchObject({
      email: 'bob@new.com',
      displayName: 'Bobby',
      lastLoginAt: '2026-05-29T10:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('mints distinct users for the same subject under a different connection', async () => {
    const a = await store.provisionFromProfile(profile());
    const b = await store.provisionFromProfile(profile({ connectionId: 'conn-2' }));
    expect(a.id).toBe('usr_1');
    expect(b.id).toBe('usr_2');
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('persists a null displayName', async () => {
    const u = await store.provisionFromProfile(profile({ displayName: null }), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(u.displayName).toBeNull();
    expect((await store.get(u.id))?.displayName).toBeNull();
  });
});

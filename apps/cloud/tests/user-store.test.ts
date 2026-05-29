// SPDX-License-Identifier: Elastic-2.0
/**
 * `createPgUserStore` against PGlite + the generated migration — real
 * Postgres semantics in-process. Mirrors the in-memory store's contract
 * (provision-on-first-login, refresh-in-place preserving createdAt) so the
 * adapter and the reference impl stay in lock-step.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { SsoProfile, UserStore } from '@pinagent/ee-auth';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../src/db/schema';
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

describe('PgUserStore', () => {
  let db: ReturnType<typeof drizzle>;
  let store: UserStore;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgUserStore(db);
  });

  it('returns null for an unknown user', async () => {
    expect(await store.get('nobody')).toBeNull();
  });

  it('provisions on first login (id == subject) and reads it back', async () => {
    const created = await store.provisionFromProfile(profile(), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(created).toEqual({
      id: 'idp-user-9',
      email: 'bob@acme.com',
      displayName: 'Bob',
      createdAt: '2026-05-29T10:00:00.000Z',
      lastLoginAt: '2026-05-29T10:00:00.000Z',
    });
    expect(await store.get('idp-user-9')).toEqual(created);
  });

  it('refreshes in place on re-login, preserving createdAt (no duplicate row)', async () => {
    await store.provisionFromProfile(profile(), { now: '2026-01-01T00:00:00.000Z' });
    const updated = await store.provisionFromProfile(
      profile({ email: 'bob@new.com', displayName: 'Bobby' }),
      { now: '2026-05-29T10:00:00.000Z' },
    );
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    const read = await store.get('idp-user-9');
    expect(read).toMatchObject({
      email: 'bob@new.com',
      displayName: 'Bobby',
      lastLoginAt: '2026-05-29T10:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('persists a null displayName', async () => {
    const u = await store.provisionFromProfile(profile({ displayName: null }), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(u.displayName).toBeNull();
    expect((await store.get('idp-user-9'))?.displayName).toBeNull();
  });
});

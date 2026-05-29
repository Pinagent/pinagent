// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgBranchRoutingStore } from '../src/db/branch-routing-store';
import { schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('PgBranchRoutingStore', () => {
  let store: ReturnType<typeof createPgBranchRoutingStore>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgBranchRoutingStore(db);
  });

  it('returns null when an org has no policy', async () => {
    expect(await store.get('nobody')).toBeNull();
  });

  it('round-trips a policy (incl. the jsonb pattern array)', async () => {
    await store.upsert({
      organizationId: 'acme',
      defaultBaseBranch: 'develop',
      allowedBranchPatterns: ['feat/*', 'fix/*'],
    });
    expect(await store.get('acme')).toEqual({
      organizationId: 'acme',
      defaultBaseBranch: 'develop',
      allowedBranchPatterns: ['feat/*', 'fix/*'],
    });
  });

  it('persists a null defaultBaseBranch and empty patterns', async () => {
    await store.upsert({
      organizationId: 'acme',
      defaultBaseBranch: null,
      allowedBranchPatterns: [],
    });
    expect(await store.get('acme')).toMatchObject({
      defaultBaseBranch: null,
      allowedBranchPatterns: [],
    });
  });

  it('updates in place on conflict', async () => {
    await store.upsert({
      organizationId: 'acme',
      defaultBaseBranch: 'main',
      allowedBranchPatterns: [],
    });
    await store.upsert({
      organizationId: 'acme',
      defaultBaseBranch: 'release',
      allowedBranchPatterns: ['release/*'],
    });
    expect(await store.get('acme')).toMatchObject({
      defaultBaseBranch: 'release',
      allowedBranchPatterns: ['release/*'],
    });
  });
});

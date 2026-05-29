// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgCostControlStore } from '../src/db/cost-control-store';
import { schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('PgCostControlStore', () => {
  let store: ReturnType<typeof createPgCostControlStore>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgCostControlStore(db);
  });

  it('returns null when an org has no cost control', async () => {
    expect(await store.get('nobody')).toBeNull();
  });

  it('round-trips a control', async () => {
    await store.upsert({
      organizationId: 'acme',
      maxRelaySessionsPerPeriod: 500,
      enforcement: 'block',
    });
    expect(await store.get('acme')).toEqual({
      organizationId: 'acme',
      maxRelaySessionsPerPeriod: 500,
      enforcement: 'block',
    });
  });

  it('persists a null cap', async () => {
    await store.upsert({
      organizationId: 'acme',
      maxRelaySessionsPerPeriod: null,
      enforcement: 'warn',
    });
    expect(await store.get('acme')).toMatchObject({
      maxRelaySessionsPerPeriod: null,
      enforcement: 'warn',
    });
  });

  it('updates in place on conflict', async () => {
    await store.upsert({
      organizationId: 'acme',
      maxRelaySessionsPerPeriod: 10,
      enforcement: 'block',
    });
    await store.upsert({
      organizationId: 'acme',
      maxRelaySessionsPerPeriod: 20,
      enforcement: 'warn',
    });
    expect(await store.get('acme')).toMatchObject({
      maxRelaySessionsPerPeriod: 20,
      enforcement: 'warn',
    });
  });
});

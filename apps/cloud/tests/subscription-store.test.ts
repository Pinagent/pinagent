// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../src/db/schema';
import { createPgSubscriptionStore } from '../src/db/subscription-store';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('PgSubscriptionStore', () => {
  let store: ReturnType<typeof createPgSubscriptionStore>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgSubscriptionStore(db);
  });

  it('returns null when an org has no subscription', async () => {
    expect(await store.get('nobody')).toBeNull();
  });

  it('upserts then reads back a subscription', async () => {
    await store.upsert({
      organizationId: 'acme',
      planId: 'pro',
      currentPeriodStart: '2026-05-01T00:00:00Z',
    });
    expect(await store.get('acme')).toEqual({
      organizationId: 'acme',
      planId: 'pro',
      currentPeriodStart: '2026-05-01T00:00:00Z',
    });
  });

  it('updates the plan in place on conflict', async () => {
    await store.upsert({
      organizationId: 'acme',
      planId: 'free',
      currentPeriodStart: '2026-05-01T00:00:00Z',
    });
    await store.upsert({
      organizationId: 'acme',
      planId: 'enterprise',
      currentPeriodStart: '2026-06-01T00:00:00Z',
    });
    expect(await store.get('acme')).toMatchObject({
      planId: 'enterprise',
      currentPeriodStart: '2026-06-01T00:00:00Z',
    });
  });
});

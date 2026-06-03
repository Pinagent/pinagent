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
      stripeCustomerId: null, // unset → null
    });
  });

  it('persists and reads back the Stripe customer id', async () => {
    await store.upsert({
      organizationId: 'acme',
      planId: 'pro',
      currentPeriodStart: '2026-05-01T00:00:00Z',
      stripeCustomerId: 'cus_123',
    });
    expect(await store.get('acme')).toMatchObject({ stripeCustomerId: 'cus_123' });
    // An update that omits it clears it — the store persists exactly what it's
    // given; the config endpoint is responsible for preserving the mapping.
    await store.upsert({
      organizationId: 'acme',
      planId: 'pro',
      currentPeriodStart: '2026-06-01T00:00:00Z',
    });
    expect(await store.get('acme')).toMatchObject({ stripeCustomerId: null });
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

  it('pages subscriptions by organizationId keyset for the rollover pass', async () => {
    for (const organizationId of ['c', 'a', 'b']) {
      await store.upsert({
        organizationId,
        planId: 'pro',
        currentPeriodStart: '2026-05-01T00:00:00Z',
      });
    }
    const page1 = await store.listPage({ limit: 2 });
    expect(page1.map((s) => s.organizationId)).toEqual(['a', 'b']); // ascending, capped
    const page2 = await store.listPage({ after: 'b', limit: 2 });
    expect(page2.map((s) => s.organizationId)).toEqual(['c']);
    expect(await store.listPage({ after: 'c', limit: 2 })).toEqual([]);
  });
});

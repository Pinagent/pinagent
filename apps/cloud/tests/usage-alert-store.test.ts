// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../src/db/schema';
import { createPgUsageAlertStore } from '../src/db/usage-alert-store';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('PgUsageAlertStore', () => {
  let store: ReturnType<typeof createPgUsageAlertStore>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgUsageAlertStore(db);
  });

  it('claims atomically: first wins, repeats lose', async () => {
    const slot = {
      organizationId: 'acme',
      periodStart: '2026-06-01',
      severity: 'blocked' as const,
    };
    expect(await store.claim(slot)).toBe(true);
    expect(await store.claim(slot)).toBe(false);
  });

  it('dedups under concurrent claims (PK conflict → exactly one true)', async () => {
    const slot = { organizationId: 'acme', periodStart: '', severity: 'warning' as const };
    const results = await Promise.all(Array.from({ length: 5 }, () => store.claim(slot)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('separates orgs, periods, and severities', async () => {
    expect(await store.claim({ organizationId: 'a', periodStart: 'p1', severity: 'warning' })).toBe(
      true,
    );
    expect(await store.claim({ organizationId: 'b', periodStart: 'p1', severity: 'warning' })).toBe(
      true,
    );
    expect(await store.claim({ organizationId: 'a', periodStart: 'p2', severity: 'warning' })).toBe(
      true,
    );
    expect(await store.claim({ organizationId: 'a', periodStart: 'p1', severity: 'blocked' })).toBe(
      true,
    );
    expect(await store.claim({ organizationId: 'a', periodStart: 'p1', severity: 'warning' })).toBe(
      false,
    );
  });
});

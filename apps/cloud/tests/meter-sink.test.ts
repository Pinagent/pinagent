// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { UsageEvent } from '@pinagent/ee-billing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgMeterSink } from '../src/db/meter-sink';
import { schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

function usage(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    occurredAt: '2026-05-01T00:00:00.000Z',
    organizationId: 'acme',
    kind: 'relay.session',
    quantity: 1,
    ...overrides,
  };
}

describe('PgMeterSink', () => {
  let meter: ReturnType<typeof createPgMeterSink>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    meter = createPgMeterSink(db);
  });

  it('records and sums usage by kind', async () => {
    await meter.record(usage({ quantity: 1 }));
    await meter.record(usage({ quantity: 2 }));
    await meter.record(usage({ kind: 'other.kind', quantity: 5 }));
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({
      'relay.session': 3,
      'other.kind': 5,
    });
  });

  it('scopes the summary to the organization', async () => {
    await meter.record(usage({ organizationId: 'acme', quantity: 4 }));
    await meter.record(usage({ organizationId: 'other', quantity: 9 }));
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({ 'relay.session': 4 });
  });

  it('honours the `since` window', async () => {
    await meter.record(usage({ occurredAt: '2026-04-30T00:00:00.000Z', quantity: 7 }));
    await meter.record(usage({ occurredAt: '2026-05-10T00:00:00.000Z', quantity: 2 }));
    expect(
      await meter.summarize({ organizationId: 'acme', since: '2026-05-01T00:00:00.000Z' }),
    ).toEqual({ 'relay.session': 2 });
  });

  it('honours the half-open `[since, until)` window', async () => {
    await meter.record(usage({ occurredAt: '2026-04-10T00:00:00.000Z', quantity: 3 })); // inside
    await meter.record(usage({ occurredAt: '2026-05-01T00:00:00.000Z', quantity: 4 })); // at until → excluded
    await meter.record(usage({ occurredAt: '2026-05-09T00:00:00.000Z', quantity: 5 })); // after
    expect(
      await meter.summarize({
        organizationId: 'acme',
        since: '2026-04-01T00:00:00.000Z',
        until: '2026-05-01T00:00:00.000Z',
      }),
    ).toEqual({ 'relay.session': 3 });
  });

  it('returns an empty summary for an org with no usage', async () => {
    expect(await meter.summarize({ organizationId: 'nobody' })).toEqual({});
  });

  it('rejects a malformed quantity before inserting', async () => {
    await expect(meter.record(usage({ quantity: -1 }))).rejects.toThrow(/non-negative integer/);
    await expect(meter.record(usage({ quantity: 1.5 }))).rejects.toThrow(/non-negative integer/);
    expect(await meter.summarize({ organizationId: 'acme' })).toEqual({}); // nothing inserted
  });
});

// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { AuditEvent } from '@pinagent/ee-team-features';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgAuditSink } from '../src/db/audit-sink';
import { schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    occurredAt: '2026-05-01T00:00:00.000Z',
    organizationId: 'acme',
    actorUserId: 'user-1',
    action: 'relay.session.issued',
    ...overrides,
  };
}

describe('PgAuditSink', () => {
  let sink: ReturnType<typeof createPgAuditSink>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    sink = createPgAuditSink(db);
  });

  it('records and reads back an event, preserving metadata + null actor', async () => {
    await sink.record(
      event({ actorUserId: null, targetId: 'sess-1', metadata: { reason: 'membership' } }),
    );
    const rows = await sink.list({ organizationId: 'acme' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      occurredAt: '2026-05-01T00:00:00.000Z',
      organizationId: 'acme',
      actorUserId: null,
      action: 'relay.session.issued',
      targetId: 'sess-1',
      metadata: { reason: 'membership' },
    });
  });

  it('omits optional fields when absent', async () => {
    await sink.record(event());
    const [row] = await sink.list({ organizationId: 'acme' });
    expect(row).not.toHaveProperty('targetId');
    expect(row).not.toHaveProperty('metadata');
  });

  it('scopes list() to the organization and returns newest-first', async () => {
    await sink.record(event({ occurredAt: '2026-05-01T00:00:00.000Z', targetId: 'a' }));
    await sink.record(event({ occurredAt: '2026-05-03T00:00:00.000Z', targetId: 'c' }));
    await sink.record(event({ occurredAt: '2026-05-02T00:00:00.000Z', targetId: 'b' }));
    await sink.record(event({ organizationId: 'other', targetId: 'x' }));

    const rows = await sink.list({ organizationId: 'acme', limit: 2 });
    expect(rows.map((r) => r.targetId)).toEqual(['c', 'b']);
  });
});

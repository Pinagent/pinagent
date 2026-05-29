// SPDX-License-Identifier: Elastic-2.0
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgActiveSessionStore } from '../src/db/active-session-store';
import { schema } from '../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const at = '2026-05-29T00:00:00.000Z';

describe('PgActiveSessionStore', () => {
  let store: ReturnType<typeof createPgActiveSessionStore>;

  beforeEach(async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgActiveSessionStore(db);
  });

  it('lists connected sessions for an org, isolating other orgs', async () => {
    await store.recordConnected({ organizationId: 'acme', sessionId: 's1', connectedAt: at });
    await store.recordConnected({ organizationId: 'acme', sessionId: 's2', connectedAt: at });
    await store.recordConnected({ organizationId: 'other', sessionId: 's3', connectedAt: at });

    const acme = await store.listByOrg('acme');
    expect(acme.map((s) => s.sessionId).sort()).toEqual(['s1', 's2']);
    expect(await store.listByOrg('nobody')).toEqual([]);
  });

  it('upserts connectedAt on a repeat connect (idempotent per session)', async () => {
    await store.recordConnected({ organizationId: 'acme', sessionId: 's1', connectedAt: at });
    await store.recordConnected({
      organizationId: 'acme',
      sessionId: 's1',
      connectedAt: '2026-05-29T02:00:00.000Z',
    });
    const sessions = await store.listByOrg('acme');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.connectedAt).toBe('2026-05-29T02:00:00.000Z');
  });

  it('removes a session on disconnect and tolerates unknown ones', async () => {
    await store.recordConnected({ organizationId: 'acme', sessionId: 's1', connectedAt: at });
    await store.recordDisconnected('acme', 's1');
    expect(await store.listByOrg('acme')).toEqual([]);
    await expect(store.recordDisconnected('acme', 'ghost')).resolves.toBeUndefined();
  });
});

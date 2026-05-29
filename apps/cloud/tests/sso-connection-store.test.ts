// SPDX-License-Identifier: Elastic-2.0
/**
 * `createPgSsoConnectionStore` against PGlite + the generated migration —
 * real Postgres semantics in-process. Mirrors the in-memory store's
 * contract (id lookup, enabled-only case-insensitive domain discovery via
 * the `jsonb_array_elements_text` query, org scoping, upsert-by-id) so the
 * adapter and the reference impl stay in lock-step.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { SsoConnection, SsoConnectionStore } from '@pinagent/ee-auth';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../src/db/schema';
import { createPgSsoConnectionStore } from '../src/db/sso-connection-store';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

function connection(overrides: Partial<SsoConnection> = {}): SsoConnection {
  return {
    id: 'conn-acme',
    organizationId: 'acme',
    protocol: 'oidc',
    issuer: 'https://idp.acme.test',
    domains: ['acme.com'],
    enabled: true,
    ...overrides,
  };
}

describe('PgSsoConnectionStore', () => {
  let db: ReturnType<typeof drizzle>;
  let store: SsoConnectionStore;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    store = createPgSsoConnectionStore(db);
  });

  it('returns null for an unknown id', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('round-trips an upserted connection', async () => {
    const c = connection();
    await store.upsert(c);
    expect(await store.get('conn-acme')).toEqual(c);
  });

  it('discovers an enabled connection by domain, case-insensitively', async () => {
    await store.upsert(connection({ domains: ['Acme.com'] }));
    expect(await store.findByDomain('ACME.COM')).toMatchObject({ id: 'conn-acme' });
  });

  it('does not discover a disabled connection by domain', async () => {
    await store.upsert(connection({ enabled: false }));
    expect(await store.findByDomain('acme.com')).toBeNull();
  });

  it('returns null discovering an empty / unmatched domain', async () => {
    await store.upsert(connection());
    expect(await store.findByDomain('')).toBeNull();
    expect(await store.findByDomain('other.com')).toBeNull();
  });

  it('lists connections scoped to one organization', async () => {
    await store.upsert(connection({ id: 'a', organizationId: 'acme' }));
    await store.upsert(connection({ id: 'b', organizationId: 'acme', domains: ['acme.io'] }));
    await store.upsert(connection({ id: 'c', organizationId: 'other', domains: ['other.com'] }));
    const acme = await store.listByOrganization('acme');
    expect(acme.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('upserts by id (replace in place, not duplicate)', async () => {
    await store.upsert(connection());
    await store.upsert(connection({ issuer: 'https://new.idp.test', domains: ['acme.org'] }));
    expect(await store.get('conn-acme')).toMatchObject({ issuer: 'https://new.idp.test' });
    expect(await store.listByOrganization('acme')).toHaveLength(1);
    expect(await store.findByDomain('acme.com')).toBeNull();
    expect(await store.findByDomain('acme.org')).toMatchObject({ id: 'conn-acme' });
  });
});

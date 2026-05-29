// SPDX-License-Identifier: Elastic-2.0
/**
 * `createInMemorySsoConnectionStore` — the reference `SsoConnectionStore`
 * the login routes resolve connections against and the PGlite-backed
 * Postgres adapter is checked for parity with. Pins id lookup, the
 * enabled-only + case-insensitive domain discovery, org scoping, and
 * upsert-by-id semantics.
 */
import type { SsoConnection } from '@pinagent/ee-auth';
import { createInMemorySsoConnectionStore } from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';

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

describe('createInMemorySsoConnectionStore', () => {
  it('returns null for an unknown id', async () => {
    const store = createInMemorySsoConnectionStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('gets a seeded connection by id (regardless of enabled)', async () => {
    const disabled = connection({ enabled: false });
    const store = createInMemorySsoConnectionStore([disabled]);
    expect(await store.get('conn-acme')).toEqual(disabled);
  });

  it('discovers an enabled connection by domain, case-insensitively', async () => {
    const store = createInMemorySsoConnectionStore([connection({ domains: ['Acme.com'] })]);
    expect(await store.findByDomain('ACME.COM')).toMatchObject({ id: 'conn-acme' });
  });

  it('does not discover a disabled connection by domain', async () => {
    const store = createInMemorySsoConnectionStore([connection({ enabled: false })]);
    expect(await store.findByDomain('acme.com')).toBeNull();
  });

  it('returns null discovering an empty / unmatched domain', async () => {
    const store = createInMemorySsoConnectionStore([connection()]);
    expect(await store.findByDomain('')).toBeNull();
    expect(await store.findByDomain('other.com')).toBeNull();
  });

  it('lists connections scoped to one organization', async () => {
    const store = createInMemorySsoConnectionStore([
      connection({ id: 'a', organizationId: 'acme' }),
      connection({ id: 'b', organizationId: 'acme', domains: ['acme.io'] }),
      connection({ id: 'c', organizationId: 'other', domains: ['other.com'] }),
    ]);
    const acme = await store.listByOrganization('acme');
    expect(acme.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('upserts by id (replace in place, not duplicate)', async () => {
    const store = createInMemorySsoConnectionStore([connection()]);
    await store.upsert(connection({ issuer: 'https://new.idp.test', domains: ['acme.org'] }));
    expect(await store.get('conn-acme')).toMatchObject({
      issuer: 'https://new.idp.test',
      domains: ['acme.org'],
    });
    expect(await store.listByOrganization('acme')).toHaveLength(1);
    // The old domain no longer resolves; the new one does.
    expect(await store.findByDomain('acme.com')).toBeNull();
    expect(await store.findByDomain('acme.org')).toMatchObject({ id: 'conn-acme' });
  });
});

// SPDX-License-Identifier: Elastic-2.0
/**
 * `createInMemoryUserStore` + the pure `userFromProfile` — the JIT
 * provisioning the SSO callback performs. Pins: `id` is a synthetic id
 * resolved from `(connectionId, subject)` (NOT the subject), stable across
 * logins for the same identity; createdAt stamped once and preserved;
 * email/displayName/lastLoginAt refreshed each login.
 */
import type { SsoProfile, User } from '@pinagent/ee-auth';
import { createInMemoryUserStore, userFromProfile } from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';

function profile(overrides: Partial<SsoProfile> = {}): SsoProfile {
  return {
    connectionId: 'conn-1',
    subject: 'idp-user-9',
    email: 'bob@acme.com',
    displayName: 'Bob',
    groups: [],
    ...overrides,
  };
}

/** Deterministic id generator for assertions: usr_1, usr_2, … */
function sequentialIds() {
  let n = 0;
  return () => `usr_${++n}`;
}

describe('userFromProfile', () => {
  it('uses the supplied id and stamps createdAt on first login', () => {
    const u = userFromProfile('usr_42', profile(), null, '2026-05-29T10:00:00.000Z');
    expect(u).toEqual({
      id: 'usr_42',
      email: 'bob@acme.com',
      displayName: 'Bob',
      createdAt: '2026-05-29T10:00:00.000Z',
      lastLoginAt: '2026-05-29T10:00:00.000Z',
    });
  });

  it('preserves the prior createdAt but refreshes profile fields + lastLoginAt', () => {
    const previous: User = {
      id: 'usr_42',
      email: 'old@acme.com',
      displayName: 'Old',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: '2026-01-01T00:00:00.000Z',
    };
    const u = userFromProfile(
      'usr_42',
      profile({ email: 'new@acme.com', displayName: 'New' }),
      previous,
      '2026-05-29T10:00:00.000Z',
    );
    expect(u.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(u.email).toBe('new@acme.com');
    expect(u.displayName).toBe('New');
    expect(u.lastLoginAt).toBe('2026-05-29T10:00:00.000Z');
  });
});

describe('createInMemoryUserStore', () => {
  it('returns null for an unknown user', async () => {
    expect(await createInMemoryUserStore().get('nobody')).toBeNull();
  });

  it('mints a synthetic id (not the subject) on first login, then reads it back', async () => {
    const store = createInMemoryUserStore([], { generateId: sequentialIds() });
    const created = await store.provisionFromProfile(profile(), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(created.id).toBe('usr_1');
    expect(created.id).not.toBe('idp-user-9'); // decoupled from the IdP subject
    expect(await store.get('usr_1')).toEqual(created);
  });

  it('resolves the same (connectionId, subject) to the same id, preserving createdAt', async () => {
    const store = createInMemoryUserStore([], { generateId: sequentialIds() });
    const first = await store.provisionFromProfile(profile(), { now: '2026-01-01T00:00:00.000Z' });
    const again = await store.provisionFromProfile(profile({ displayName: 'Bobby' }), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(again.id).toBe(first.id); // same identity → same user, no new id minted
    expect(again.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(again.displayName).toBe('Bobby');
    expect(again.lastLoginAt).toBe('2026-05-29T10:00:00.000Z');
  });

  it('mints distinct users for different subjects or different connections', async () => {
    const store = createInMemoryUserStore([], { generateId: sequentialIds() });
    const a = await store.provisionFromProfile(profile({ subject: 'sub-a' }));
    const b = await store.provisionFromProfile(profile({ subject: 'sub-b' }));
    // same raw subject string but a different connection is a different identity
    const c = await store.provisionFromProfile(
      profile({ subject: 'sub-a', connectionId: 'conn-2' }),
    );
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });
});

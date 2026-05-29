// SPDX-License-Identifier: Elastic-2.0
/**
 * `createInMemoryUserStore` + the pure `userFromProfile` — the JIT
 * provisioning the SSO callback performs. Pins: id == IdP subject (so
 * memberships keep matching), createdAt stamped once and preserved across
 * logins, email/displayName/lastLoginAt refreshed each login.
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

describe('userFromProfile', () => {
  it('keys the user on the IdP subject and stamps createdAt on first login', () => {
    const u = userFromProfile(profile(), null, '2026-05-29T10:00:00.000Z');
    expect(u).toEqual({
      id: 'idp-user-9',
      email: 'bob@acme.com',
      displayName: 'Bob',
      createdAt: '2026-05-29T10:00:00.000Z',
      lastLoginAt: '2026-05-29T10:00:00.000Z',
    });
  });

  it('preserves the prior createdAt but refreshes profile fields + lastLoginAt', () => {
    const previous: User = {
      id: 'idp-user-9',
      email: 'old@acme.com',
      displayName: 'Old',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: '2026-01-01T00:00:00.000Z',
    };
    const u = userFromProfile(
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

  it('provisions on first login, then reads back by id', async () => {
    const store = createInMemoryUserStore();
    const created = await store.provisionFromProfile(profile(), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(created.id).toBe('idp-user-9');
    expect(await store.get('idp-user-9')).toEqual(created);
  });

  it('refreshes an existing user in place, preserving createdAt', async () => {
    const store = createInMemoryUserStore();
    await store.provisionFromProfile(profile(), { now: '2026-01-01T00:00:00.000Z' });
    const updated = await store.provisionFromProfile(profile({ displayName: 'Bobby' }), {
      now: '2026-05-29T10:00:00.000Z',
    });
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.displayName).toBe('Bobby');
    expect(updated.lastLoginAt).toBe('2026-05-29T10:00:00.000Z');
  });
});

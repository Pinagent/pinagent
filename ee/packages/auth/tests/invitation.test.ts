// SPDX-License-Identifier: Elastic-2.0
import type { Invitation } from '@pinagent/ee-auth';
import { createInMemoryInvitationStore, normalizeEmail } from '@pinagent/ee-auth';
import { describe, expect, it } from 'vitest';

function invite(overrides: Partial<Invitation> = {}): Invitation {
  return {
    organizationId: 'acme',
    email: 'Bob@Acme.com',
    role: 'member',
    invitedAt: '2026-01-01T00:00:00Z',
    invitedByUserId: 'usr_admin',
    ...overrides,
  };
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Bob@Acme.COM ')).toBe('bob@acme.com');
  });
});

describe('createInMemoryInvitationStore', () => {
  it('stores normalized email and reads it back case-insensitively', async () => {
    const store = createInMemoryInvitationStore();
    await store.upsert(invite());
    expect(await store.get('acme', 'bob@acme.com')).toMatchObject({
      email: 'bob@acme.com',
      role: 'member',
    });
    // lookup tolerates different casing/whitespace
    expect(await store.get('acme', '  BOB@ACME.COM ')).not.toBeNull();
    expect(await store.get('other', 'bob@acme.com')).toBeNull();
  });

  it('upsert overwrites the pending role for a re-invite (no duplicate)', async () => {
    const store = createInMemoryInvitationStore();
    await store.upsert(invite({ role: 'member' }));
    await store.upsert(invite({ role: 'admin' }));
    expect(await store.listByOrg('acme')).toEqual([
      expect.objectContaining({ email: 'bob@acme.com', role: 'admin' }),
    ]);
  });

  it('lists per org and removes', async () => {
    const store = createInMemoryInvitationStore();
    await store.upsert(invite({ email: 'a@acme.com' }));
    await store.upsert(invite({ email: 'b@acme.com' }));
    await store.upsert(invite({ organizationId: 'other', email: 'c@other.com' }));
    expect((await store.listByOrg('acme')).map((i) => i.email).sort()).toEqual([
      'a@acme.com',
      'b@acme.com',
    ]);
    await store.remove('acme', 'A@ACME.COM');
    expect(await store.get('acme', 'a@acme.com')).toBeNull();
  });
});

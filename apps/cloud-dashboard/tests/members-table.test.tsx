// SPDX-License-Identifier: Elastic-2.0
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Member } from '../src/api-client';
import { MembersTable } from '../src/MembersTable';

const member = (over: Partial<Member> = {}): Member => ({
  organizationId: 'acme',
  userId: 'usr_1',
  role: 'member',
  status: 'active',
  invitedAt: '2026-01-01T00:00:00.000Z',
  joinedAt: '2026-01-02T00:00:00.000Z',
  email: null,
  displayName: null,
  ...over,
});

const noop = () => {};

describe('MembersTable', () => {
  it('renders each member with name/email, a role select, and a Remove control', () => {
    const html = renderToStaticMarkup(
      <MembersTable
        members={[
          member({ userId: 'usr_a', role: 'admin', displayName: 'Alice', email: 'alice@acme.com' }),
        ]}
        onChangeRole={noop}
        onRemove={noop}
      />,
    );
    expect(html).toContain('Alice');
    expect(html).toContain('alice@acme.com');
    // role select pre-selects the member's current role and offers all roles
    expect(html).toMatch(/<option value="admin"[^>]*selected/);
    expect(html).toContain('<option value="viewer"');
    expect(html).toContain('<option value="owner"');
    expect(html).toContain('Remove');
  });

  it('falls back to the id when there is no name/email', () => {
    const html = renderToStaticMarkup(
      <MembersTable members={[member({ userId: 'usr_b' })]} onChangeRole={noop} onRemove={noop} />,
    );
    expect(html).toContain('usr_b');
  });

  it('shows the empty state with no members', () => {
    const html = renderToStaticMarkup(
      <MembersTable members={[]} onChangeRole={noop} onRemove={noop} />,
    );
    expect(html).toContain('No members yet.');
    expect(html).not.toContain('Remove');
  });
});

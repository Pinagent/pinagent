// SPDX-License-Identifier: Elastic-2.0
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Invitation } from '../src/api-client';
import { InviteForm, PendingInvitations } from '../src/MembersAdmin';

const noop = async () => {};

const invite = (over: Partial<Invitation> = {}): Invitation => ({
  organizationId: 'acme',
  email: 'a@acme.com',
  role: 'member',
  invitedAt: '2026-01-01T00:00:00Z',
  invitedByUserId: null,
  ...over,
});

describe('InviteForm', () => {
  it('renders an email field, the invitable roles, and a submit button', () => {
    // useState hooks → render as JSX, not a direct call.
    const html = renderToStaticMarkup(<InviteForm onSubmit={noop} />);
    expect(html).toContain('type="email"');
    expect(html).toContain('<option value="viewer"');
    expect(html).toContain('<option value="member"');
    expect(html).toContain('<option value="admin"');
    // owner is not invitable
    expect(html).not.toContain('value="owner"');
    expect(html).toContain('Invite');
    // member is the default selected role
    expect(html).toMatch(/<option value="member"[^>]*selected/);
  });
});

describe('PendingInvitations', () => {
  it('lists each pending invite with a revoke control', () => {
    const html = renderToStaticMarkup(
      PendingInvitations({
        invitations: [invite({ email: 'bob@acme.com', role: 'admin' })],
        onRevoke: () => {},
      }),
    );
    expect(html).toContain('bob@acme.com');
    expect(html).toContain('admin');
    expect(html).toContain('Revoke');
  });

  it('shows an empty state with no invitations', () => {
    const html = renderToStaticMarkup(PendingInvitations({ invitations: [], onRevoke: () => {} }));
    expect(html).toContain('No pending invitations.');
    expect(html).not.toContain('Revoke');
  });
});

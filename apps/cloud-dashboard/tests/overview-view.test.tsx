// SPDX-License-Identifier: Elastic-2.0
import type { OrganizationMembership } from '@pinagent/ee-auth';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/format';
import { OverviewView } from '../src/Overview';

const member = (over: Partial<OrganizationMembership>): OrganizationMembership => ({
  organizationId: 'org_1',
  userId: 'user_1',
  role: 'member',
  status: 'active',
  invitedAt: '2026-01-01T00:00:00.000Z',
  joinedAt: '2026-01-02T00:00:00.000Z',
  ...over,
});

describe('formatDuration', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h');
  });
});

describe('OverviewView', () => {
  it('renders usage totals and the member roster', () => {
    const html = renderToStaticMarkup(
      OverviewView({
        usage: { 'relay.session': 1234, 'relay.connection.seconds': 3661 },
        members: [
          member({ userId: 'alice', role: 'admin' }),
          member({ userId: 'bob', status: 'invited', joinedAt: null }),
        ],
      }),
    );

    expect(html).toContain('1,234');
    expect(html).toContain('1h 1m');
    expect(html).toContain('alice');
    expect(html).toContain('admin');
    expect(html).toContain('bob');
    expect(html).toContain('invited');
    // pending member shows a placeholder for the missing join date
    expect(html).toContain('—');
  });

  it('shows an empty state with no members', () => {
    const html = renderToStaticMarkup(OverviewView({ usage: {}, members: [] }));
    expect(html).toContain('No members yet.');
    // usage falls back to zero
    expect(html).toContain('>0<');
  });
});

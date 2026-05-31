// SPDX-License-Identifier: Elastic-2.0
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Member } from '../src/api-client';
import { formatDuration } from '../src/format';
import { OverviewView } from '../src/Overview';

const member = (over: Partial<Member>): Member => ({
  organizationId: 'org_1',
  userId: 'user_1',
  role: 'member',
  status: 'active',
  invitedAt: '2026-01-01T00:00:00.000Z',
  joinedAt: '2026-01-02T00:00:00.000Z',
  email: null,
  displayName: null,
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
  it('renders the usage + member-count stats', () => {
    // The roster table itself now lives in MembersTable; OverviewView owns the
    // three stat cards.
    const html = renderToStaticMarkup(
      OverviewView({
        usage: { 'relay.session': 1234, 'relay.connection.seconds': 3661 },
        members: [member({ userId: 'usr_a' }), member({ userId: 'usr_b' })],
      }),
    );

    expect(html).toContain('1,234'); // relay sessions
    expect(html).toContain('1h 1m'); // connection time
    expect(html).toContain('>2<'); // member count
  });

  it('falls usage back to zero with no data', () => {
    const html = renderToStaticMarkup(OverviewView({ usage: {}, members: [] }));
    expect(html).toContain('>0<');
  });
});

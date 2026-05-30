// SPDX-License-Identifier: Elastic-2.0
import type { AuditEvent } from '@pinagent/ee-team-features';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditView } from '../src/Audit';

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  occurredAt: '2026-05-30T12:00:00Z',
  organizationId: 'org_1',
  actorUserId: 'u-admin',
  action: 'relay.session.issued',
  targetId: 'sess-1',
  ...over,
});

describe('AuditView', () => {
  it('renders a row per event with time, actor, action, and target', () => {
    const html = renderToStaticMarkup(
      AuditView({
        events: [
          event(),
          event({ action: 'sso.login', targetId: undefined, occurredAt: '2026-05-30T11:00:00Z' }),
        ],
      }),
    );
    expect(html).toContain('30 May 2026, 12:00 UTC');
    expect(html).toContain('u-admin');
    expect(html).toContain('relay.session.issued');
    expect(html).toContain('sess-1');
    expect(html).toContain('sso.login');
  });

  it('shows "system" for an unauthenticated actor and "—" for a missing target', () => {
    const html = renderToStaticMarkup(
      AuditView({ events: [event({ actorUserId: null, targetId: undefined })] }),
    );
    expect(html).toContain('system');
    expect(html).toContain('—');
  });

  it('shows the empty state with no events', () => {
    const html = renderToStaticMarkup(AuditView({ events: [] }));
    expect(html).toContain('No audit events yet.');
    expect(html).not.toContain('<table');
  });
});

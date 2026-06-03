// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { renderInvitationEmail } from '../src/render';

describe('renderInvitationEmail', () => {
  const props = {
    organizationName: 'Acme Inc',
    role: 'admin',
    inviterName: 'Alice',
    acceptUrl: 'https://app.pinagent.dev/sso/start?returnTo=%2F',
  };

  it('renders an HTML body carrying the org, role, inviter, and CTA link', async () => {
    const { subject, html } = await renderInvitationEmail(props);
    expect(subject).toBe("You're invited to Acme Inc on Pinagent");
    expect(html).toContain('Acme Inc');
    expect(html).toContain('admin');
    expect(html).toContain('Alice');
    expect(html).toContain('https://app.pinagent.dev/sso/start?returnTo=%2F');
  });

  it('produces a non-empty plain-text fallback (no HTML tags)', async () => {
    const { text } = await renderInvitationEmail(props);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Acme Inc');
    expect(text).not.toContain('<table');
  });

  it('omits the inviter clause when no inviter is known', async () => {
    const { html } = await renderInvitationEmail({ ...props, inviterName: null });
    expect(html).toContain('You’ve been invited');
  });
});

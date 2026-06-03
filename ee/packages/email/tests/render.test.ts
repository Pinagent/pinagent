// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import {
  renderInvitationEmail,
  renderMemberRemovedEmail,
  renderRoleChangedEmail,
  renderUsageAlertEmail,
  renderWelcomeEmail,
} from '../src/render';

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

describe('renderMemberRemovedEmail', () => {
  it('names the org and the remover', async () => {
    const { subject, html, text } = await renderMemberRemovedEmail({
      organizationName: 'Acme Inc',
      removedByName: 'Alice',
    });
    expect(subject).toBe("You've been removed from Acme Inc");
    expect(html).toContain('Acme Inc');
    expect(html).toContain('Alice');
    expect(text.length).toBeGreaterThan(0);
  });

  it('falls back to a generic actor when the remover is unknown', async () => {
    const { html } = await renderMemberRemovedEmail({ organizationName: 'Acme Inc' });
    expect(html).toContain('An administrator');
  });
});

describe('renderRoleChangedEmail', () => {
  it('states the new role and links to the dashboard', async () => {
    const { subject, html } = await renderRoleChangedEmail({
      organizationName: 'Acme Inc',
      role: 'admin',
      changedByName: 'Alice',
      dashboardUrl: 'https://app.pinagent.dev/',
    });
    expect(subject).toBe('Your role in Acme Inc is now admin');
    expect(html).toContain('admin');
    expect(html).toContain('https://app.pinagent.dev/');
  });
});

describe('renderWelcomeEmail', () => {
  it('greets a named user', async () => {
    const { subject, html } = await renderWelcomeEmail({
      name: 'Alice',
      organizationName: 'Acme Inc',
      dashboardUrl: 'https://app.pinagent.dev/',
    });
    expect(subject).toBe('Welcome to Pinagent');
    expect(html).toContain('Welcome, Alice');
    expect(html).toContain('Acme Inc');
  });

  it('uses a generic greeting when no name is known', async () => {
    const { html } = await renderWelcomeEmail({ dashboardUrl: 'https://app.pinagent.dev/' });
    expect(html).toContain('Welcome to Pinagent');
  });
});

describe('renderUsageAlertEmail', () => {
  it('renders a blocked alert with used/limit and a billing link', async () => {
    const { subject, html } = await renderUsageAlertEmail({
      organizationName: 'Acme Inc',
      resource: 'relay sessions',
      used: 100,
      limit: 100,
      severity: 'blocked',
      billingUrl: 'https://app.pinagent.dev/billing',
    });
    expect(subject).toBe('Acme Inc: relay sessions limit reached');
    expect(html).toContain('blocked');
    expect(html).toContain('https://app.pinagent.dev/billing');
  });

  it('renders a warning variant', async () => {
    const { subject } = await renderUsageAlertEmail({
      organizationName: 'Acme Inc',
      resource: 'relay sessions',
      used: 90,
      limit: 100,
      severity: 'warning',
      billingUrl: 'https://app.pinagent.dev/billing',
    });
    expect(subject).toBe('Acme Inc: relay sessions usage warning');
  });
});

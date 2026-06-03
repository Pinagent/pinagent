// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it, vi } from 'vitest';
import { createMailer } from '../src/mailer';
import type { EmailMessage, EmailSender } from '../src/sender';

function recordingSender(): { sender: EmailSender; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sender: {
      async send(message) {
        sent.push(message);
      },
    },
  };
}

const APP = 'https://app.pinagent.dev/';

describe('createMailer', () => {
  it('sends an invitation with the sign-in CTA (trailing slash normalized)', async () => {
    const { sender, sent } = recordingSender();
    await createMailer(sender, { appBaseUrl: APP }).sendInvitation({
      to: 'bob@acme.com',
      organizationName: 'Acme Inc',
      role: 'member',
      inviterName: 'Alice',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('bob@acme.com');
    expect(sent[0]?.subject).toBe("You're invited to Acme Inc on Pinagent");
    expect(sent[0]?.html).toContain('https://app.pinagent.dev/sso/start?returnTo=%2F');
  });

  it('sends a member-removed notice', async () => {
    const { sender, sent } = recordingSender();
    await createMailer(sender, { appBaseUrl: APP }).sendMemberRemoved({
      to: 'bob@acme.com',
      organizationName: 'Acme Inc',
      removedByName: 'Alice',
    });
    expect(sent[0]?.subject).toBe("You've been removed from Acme Inc");
    expect(sent[0]?.html).toContain('Alice');
  });

  it('sends a role-changed notice with the new role + dashboard link', async () => {
    const { sender, sent } = recordingSender();
    await createMailer(sender, { appBaseUrl: APP }).sendRoleChanged({
      to: 'bob@acme.com',
      organizationName: 'Acme Inc',
      role: 'admin',
      changedByName: 'Alice',
    });
    expect(sent[0]?.subject).toBe('Your role in Acme Inc is now admin');
    expect(sent[0]?.html).toContain('admin');
    expect(sent[0]?.html).toContain('https://app.pinagent.dev/');
  });

  it('sends a welcome email', async () => {
    const { sender, sent } = recordingSender();
    await createMailer(sender, { appBaseUrl: APP }).sendWelcome({
      to: 'bob@acme.com',
      name: 'Bob',
      organizationName: 'Acme Inc',
    });
    expect(sent[0]?.subject).toBe('Welcome to Pinagent');
    expect(sent[0]?.html).toContain('Bob');
  });

  it('is best-effort: a transport failure is swallowed, not thrown', async () => {
    const onError = vi.fn();
    const failing: EmailSender = {
      async send() {
        throw new Error('resend down');
      },
    };
    const mailer = createMailer(failing, { appBaseUrl: APP, onError });
    await expect(
      mailer.sendMemberRemoved({ to: 'b@acme.com', organizationName: 'Acme' }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});

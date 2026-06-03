// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it, vi } from 'vitest';
import { createInvitationMailer } from '../src/invitation-mailer';
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

describe('createInvitationMailer', () => {
  it('renders and sends the invitation to the recipient with a sign-in CTA', async () => {
    const { sender, sent } = recordingSender();
    const mailer = createInvitationMailer(sender, { appBaseUrl: 'https://app.pinagent.dev/' });

    await mailer.sendInvitation({
      to: 'bob@acme.com',
      organizationName: 'Acme Inc',
      role: 'member',
      inviterName: 'Alice',
    });

    expect(sent).toHaveLength(1);
    const [msg] = sent;
    expect(msg?.to).toBe('bob@acme.com');
    expect(msg?.subject).toBe("You're invited to Acme Inc on Pinagent");
    // trailing slash on appBaseUrl is normalized; CTA points at the dashboard sign-in
    expect(msg?.html).toContain('https://app.pinagent.dev/sso/start?returnTo=%2F');
  });

  it('is best-effort: a transport failure is swallowed, not thrown', async () => {
    const onError = vi.fn();
    const failing: EmailSender = {
      async send() {
        throw new Error('resend down');
      },
    };
    const mailer = createInvitationMailer(failing, {
      appBaseUrl: 'https://app.pinagent.dev',
      onError,
    });

    await expect(
      mailer.sendInvitation({ to: 'b@acme.com', organizationName: 'Acme', role: 'member' }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});

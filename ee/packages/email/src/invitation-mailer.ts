// SPDX-License-Identifier: Elastic-2.0
import { renderInvitationEmail } from './render';
import type { EmailSender } from './sender';

/** What the control plane knows when an invite is created. */
export interface InvitationInput {
  /** Invitee's email address. */
  to: string;
  /** Org display name (the caller resolves this from the org id). */
  organizationName: string;
  /** Role granted by the invite. */
  role: string;
  /** Inviter's display name/email, if known. */
  inviterName?: string | null;
}

/**
 * High-level invite notifier: renders the {@link renderInvitationEmail}
 * template and sends it. Composed over an {@link EmailSender} so the transport
 * stays swappable, and exposed to `member-service` as a narrow optional dep
 * (like `audit`).
 */
export interface InvitationMailer {
  sendInvitation(input: InvitationInput): Promise<void>;
}

export interface InvitationMailerOptions {
  /** Absolute base URL of the dashboard — the invite CTA points at its sign-in. */
  appBaseUrl: string;
  /** Where send failures are reported; defaults to `console.error`. */
  onError?: (error: unknown) => void;
}

export function createInvitationMailer(
  sender: EmailSender,
  options: InvitationMailerOptions,
): InvitationMailer {
  const base = options.appBaseUrl.replace(/\/+$/, '');
  const onError =
    options.onError ?? ((err) => console.error('[email] invitation send failed', err));
  // The invite CTA lands on the dashboard, which kicks off SSO sign-in.
  const acceptUrl = `${base}/sso/start?returnTo=${encodeURIComponent('/')}`;

  return {
    async sendInvitation(input: InvitationInput): Promise<void> {
      // Best-effort: an email-provider outage must never fail the invite itself
      // (the membership/invitation is already persisted by the caller).
      try {
        const rendered = await renderInvitationEmail({
          organizationName: input.organizationName,
          role: input.role,
          inviterName: input.inviterName ?? null,
          acceptUrl,
        });
        await sender.send({ to: input.to, ...rendered });
      } catch (err) {
        onError(err);
      }
    },
  };
}

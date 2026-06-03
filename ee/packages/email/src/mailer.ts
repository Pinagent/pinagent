// SPDX-License-Identifier: Elastic-2.0
import {
  type RenderedEmail,
  renderInvitationEmail,
  renderMemberRemovedEmail,
  renderRoleChangedEmail,
  renderWelcomeEmail,
} from './render';
import type { EmailSender } from './sender';

/** Member invited to an org (staged or immediately granted). */
export interface InvitationInput {
  to: string;
  organizationName: string;
  role: string;
  inviterName?: string | null;
}

/** Member removed from an org. */
export interface MemberRemovedInput {
  to: string;
  organizationName: string;
  removedByName?: string | null;
}

/** A member's role changed. */
export interface RoleChangedInput {
  to: string;
  organizationName: string;
  role: string;
  changedByName?: string | null;
}

/** A user's first sign-in. */
export interface WelcomeInput {
  to: string;
  name?: string | null;
  organizationName?: string | null;
}

/**
 * High-level transactional mailer: renders the right template and sends it over
 * an {@link EmailSender}. Every method is **best-effort** — a render or
 * provider failure is swallowed (and reported via `onError`), never thrown — so
 * a notification can't fail the action that triggered it. Exposed to services
 * as narrow optional deps (each declares only the methods it calls), like
 * `audit`.
 */
export interface Mailer {
  sendInvitation(input: InvitationInput): Promise<void>;
  sendMemberRemoved(input: MemberRemovedInput): Promise<void>;
  sendRoleChanged(input: RoleChangedInput): Promise<void>;
  sendWelcome(input: WelcomeInput): Promise<void>;
}

export interface MailerOptions {
  /** Absolute dashboard base URL — used to build links in the emails. */
  appBaseUrl: string;
  /** Where send failures are reported; defaults to `console.error`. */
  onError?: (error: unknown) => void;
}

export function createMailer(sender: EmailSender, options: MailerOptions): Mailer {
  const base = options.appBaseUrl.replace(/\/+$/, '');
  const onError = options.onError ?? ((err) => console.error('[email] send failed', err));
  // The invite CTA lands on the dashboard, which kicks off SSO sign-in.
  const acceptUrl = `${base}/sso/start?returnTo=${encodeURIComponent('/')}`;
  const dashboardUrl = `${base}/`;

  /** Render + send, swallowing any failure. */
  async function dispatch(to: string, render: () => Promise<RenderedEmail>): Promise<void> {
    try {
      await sender.send({ to, ...(await render()) });
    } catch (err) {
      onError(err);
    }
  }

  return {
    sendInvitation(input) {
      return dispatch(input.to, () =>
        renderInvitationEmail({
          organizationName: input.organizationName,
          role: input.role,
          inviterName: input.inviterName ?? null,
          acceptUrl,
        }),
      );
    },
    sendMemberRemoved(input) {
      return dispatch(input.to, () =>
        renderMemberRemovedEmail({
          organizationName: input.organizationName,
          removedByName: input.removedByName ?? null,
        }),
      );
    },
    sendRoleChanged(input) {
      return dispatch(input.to, () =>
        renderRoleChangedEmail({
          organizationName: input.organizationName,
          role: input.role,
          changedByName: input.changedByName ?? null,
          dashboardUrl,
        }),
      );
    },
    sendWelcome(input) {
      return dispatch(input.to, () =>
        renderWelcomeEmail({
          name: input.name ?? null,
          organizationName: input.organizationName ?? null,
          dashboardUrl,
        }),
      );
    },
  };
}

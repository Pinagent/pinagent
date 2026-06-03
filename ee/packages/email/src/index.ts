// SPDX-License-Identifier: Elastic-2.0

/**
 * `@pinagent/ee-email` — transactional email for the Pinagent cloud control
 * plane. React Email templates (previewable via `pnpm email:dev`) rendered to
 * HTML + text, sent over a swappable {@link EmailSender} transport (Resend in
 * prod, no-op in dev/tests).
 */

export { InvitationEmail, type InvitationEmailProps } from '../emails/InvitationEmail';
export { BRAND, Layout } from './components/Layout';
export {
  createInvitationMailer,
  type InvitationInput,
  type InvitationMailer,
  type InvitationMailerOptions,
} from './invitation-mailer';
export { type RenderedEmail, renderInvitationEmail } from './render';
export {
  createResendEmailSender,
  type EmailMessage,
  EmailSendError,
  type EmailSender,
  noopEmailSender,
  type ResendEmailSenderOptions,
} from './sender';

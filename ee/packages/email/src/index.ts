// SPDX-License-Identifier: Elastic-2.0

/**
 * `@pinagent/ee-email` — transactional email for the Pinagent cloud control
 * plane. React Email templates (previewable via `pnpm email:dev`) rendered to
 * HTML + text, sent over a swappable {@link EmailSender} transport (Resend in
 * prod, no-op in dev/tests).
 */

export { InvitationEmail, type InvitationEmailProps } from '../emails/InvitationEmail';
export { MemberRemovedEmail, type MemberRemovedEmailProps } from '../emails/MemberRemovedEmail';
export { RoleChangedEmail, type RoleChangedEmailProps } from '../emails/RoleChangedEmail';
export { UsageAlertEmail, type UsageAlertEmailProps } from '../emails/UsageAlertEmail';
export { WelcomeEmail, type WelcomeEmailProps } from '../emails/WelcomeEmail';
export { BRAND, Layout } from './components/Layout';
export {
  createMailer,
  type InvitationInput,
  type Mailer,
  type MailerOptions,
  type MemberRemovedInput,
  type RoleChangedInput,
  type UsageAlertInput,
  type WelcomeInput,
} from './mailer';
export {
  type RenderedEmail,
  renderInvitationEmail,
  renderMemberRemovedEmail,
  renderRoleChangedEmail,
  renderUsageAlertEmail,
  renderWelcomeEmail,
} from './render';
export {
  createResendEmailSender,
  type EmailMessage,
  EmailSendError,
  type EmailSender,
  noopEmailSender,
  type ResendEmailSenderOptions,
} from './sender';

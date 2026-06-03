// SPDX-License-Identifier: Elastic-2.0
import { render } from '@react-email/render';
import { InvitationEmail, type InvitationEmailProps } from '../emails/InvitationEmail';
import { BRAND } from './components/Layout';

/** A fully-rendered email, ready to hand to an {@link EmailSender}. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render the member-invitation email to `{ subject, html, text }`.
 *
 * We render to HTML + a plain-text fallback here (via `@react-email/render`)
 * rather than passing the React element to the Resend SDK: the cloud runs on a
 * Cloudflare Worker, and rendering ourselves keeps the React path explicit and
 * the transport a plain `fetch` (see `createResendEmailSender`).
 */
export async function renderInvitationEmail(props: InvitationEmailProps): Promise<RenderedEmail> {
  const element = InvitationEmail(props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return {
    subject: `You're invited to ${props.organizationName} on ${BRAND.name}`,
    html,
    text,
  };
}

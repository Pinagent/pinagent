// SPDX-License-Identifier: Elastic-2.0
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { InvitationEmail, type InvitationEmailProps } from '../emails/InvitationEmail';
import { MemberRemovedEmail, type MemberRemovedEmailProps } from '../emails/MemberRemovedEmail';
import { RoleChangedEmail, type RoleChangedEmailProps } from '../emails/RoleChangedEmail';
import { UsageAlertEmail, type UsageAlertEmailProps } from '../emails/UsageAlertEmail';
import { WelcomeEmail, type WelcomeEmailProps } from '../emails/WelcomeEmail';
import { BRAND } from './components/Layout';

/** A fully-rendered email, ready to hand to an {@link EmailSender}. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render a React Email element to `{ html, text }`.
 *
 * We render to HTML + a plain-text fallback here (via `@react-email/render`)
 * rather than passing the React element to the Resend SDK: the cloud runs on a
 * Cloudflare Worker, and rendering ourselves keeps the React path explicit and
 * the transport a plain `fetch` (see `createResendEmailSender`).
 */
async function renderBoth(element: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

export async function renderInvitationEmail(props: InvitationEmailProps): Promise<RenderedEmail> {
  return {
    subject: `You're invited to ${props.organizationName} on ${BRAND.name}`,
    ...(await renderBoth(InvitationEmail(props))),
  };
}

export async function renderMemberRemovedEmail(
  props: MemberRemovedEmailProps,
): Promise<RenderedEmail> {
  return {
    subject: `You've been removed from ${props.organizationName}`,
    ...(await renderBoth(MemberRemovedEmail(props))),
  };
}

export async function renderRoleChangedEmail(props: RoleChangedEmailProps): Promise<RenderedEmail> {
  return {
    subject: `Your role in ${props.organizationName} is now ${props.role}`,
    ...(await renderBoth(RoleChangedEmail(props))),
  };
}

export async function renderWelcomeEmail(props: WelcomeEmailProps): Promise<RenderedEmail> {
  return {
    subject: `Welcome to ${BRAND.name}`,
    ...(await renderBoth(WelcomeEmail(props))),
  };
}

export async function renderUsageAlertEmail(props: UsageAlertEmailProps): Promise<RenderedEmail> {
  const what = props.severity === 'blocked' ? 'limit reached' : 'usage warning';
  return {
    subject: `${props.organizationName}: ${props.resource} ${what}`,
    ...(await renderBoth(UsageAlertEmail(props))),
  };
}

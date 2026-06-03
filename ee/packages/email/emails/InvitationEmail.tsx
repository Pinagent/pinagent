// SPDX-License-Identifier: Elastic-2.0
import { Link, Text } from '@react-email/components';
import { BRAND, Layout } from '../src/components/Layout';
import { CtaButton, styles } from '../src/components/ui';

export interface InvitationEmailProps {
  /** Display name of the organization the recipient is invited to. */
  organizationName: string;
  /** Role they'll hold (viewer | member | admin | owner). */
  role: string;
  /** Who invited them, if known — shown in the body. */
  inviterName?: string | null;
  /** Where the CTA points (the dashboard sign-in that accepts the invite). */
  acceptUrl: string;
}

/** Member-invitation email — sent when an org admin invites an address. */
export function InvitationEmail({
  organizationName,
  role,
  inviterName,
  acceptUrl,
}: InvitationEmailProps) {
  const inviter = inviterName ? `${inviterName} invited you` : 'You’ve been invited';
  return (
    <Layout preview={`You're invited to ${organizationName} on ${BRAND.name}`}>
      <Text style={styles.heading}>Join {organizationName}</Text>
      <Text style={styles.paragraph}>
        {inviter} to join <strong>{organizationName}</strong> on {BRAND.name} as a{' '}
        <strong>{role}</strong>. Sign in to accept the invitation and get started.
      </Text>
      <CtaButton href={acceptUrl}>Accept invitation</CtaButton>
      <Text style={styles.muted}>
        Or paste this link into your browser:{' '}
        <Link href={acceptUrl} style={{ color: BRAND.ink }}>
          {acceptUrl}
        </Link>
      </Text>
    </Layout>
  );
}

// Sample data for the `email dev` preview client.
InvitationEmail.PreviewProps = {
  organizationName: 'Acme Inc',
  role: 'member',
  inviterName: 'Alice',
  acceptUrl: 'https://app.pinagent.dev/sso/start?returnTo=%2F',
} satisfies InvitationEmailProps;

export default InvitationEmail;

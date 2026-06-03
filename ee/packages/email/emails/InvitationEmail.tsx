// SPDX-License-Identifier: Elastic-2.0
import { Button, Link, Text } from '@react-email/components';
import { BRAND, Layout } from '../src/components/Layout';

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

const fontFamily =
  '"Geist", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif';

const heading = { color: BRAND.ink, fontFamily, fontSize: 22, fontWeight: 700, margin: '0 0 16px' };
const body = { color: BRAND.ink, fontFamily, fontSize: 15, lineHeight: '24px', margin: '0 0 16px' };

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
      <Text style={heading}>Join {organizationName}</Text>
      <Text style={body}>
        {inviter} to join <strong>{organizationName}</strong> on {BRAND.name} as a{' '}
        <strong>{role}</strong>. Sign in to accept the invitation and get started.
      </Text>
      <Button
        href={acceptUrl}
        style={{
          backgroundColor: BRAND.ink,
          color: BRAND.cream,
          fontFamily,
          fontSize: 15,
          fontWeight: 600,
          borderRadius: 8,
          padding: '12px 20px',
          textDecoration: 'none',
        }}
      >
        Accept invitation
      </Button>
      <Text style={{ ...body, color: BRAND.muted, fontSize: 13, margin: '20px 0 0' }}>
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

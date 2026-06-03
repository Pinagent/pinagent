// SPDX-License-Identifier: Elastic-2.0
import { Text } from '@react-email/components';
import { BRAND, Layout } from '../src/components/Layout';
import { CtaButton, styles } from '../src/components/ui';

export interface WelcomeEmailProps {
  /** Recipient's display name, if known. */
  name?: string | null;
  /** Org they just signed into, if known. */
  organizationName?: string | null;
  /** Link to the dashboard. */
  dashboardUrl: string;
}

/** Sent on a user's first sign-in to Pinagent. */
export function WelcomeEmail({ name, organizationName, dashboardUrl }: WelcomeEmailProps) {
  const greeting = name ? `Welcome, ${name}` : 'Welcome to Pinagent';
  const org = organizationName ? (
    <>
      {' '}
      with <strong>{organizationName}</strong>
    </>
  ) : null;
  return (
    <Layout preview={`Welcome to ${BRAND.name}`}>
      <Text style={styles.heading}>{greeting}</Text>
      <Text style={styles.paragraph}>
        Your {BRAND.name} account is ready{org}. Click an element in your dev server, leave a
        comment, and an agent picks it up with the exact file and a screenshot.
      </Text>
      <CtaButton href={dashboardUrl}>Open dashboard</CtaButton>
    </Layout>
  );
}

WelcomeEmail.PreviewProps = {
  name: 'Alice',
  organizationName: 'Acme Inc',
  dashboardUrl: 'https://app.pinagent.dev/',
} satisfies WelcomeEmailProps;

export default WelcomeEmail;

// SPDX-License-Identifier: Elastic-2.0
import { Text } from '@react-email/components';
import { BRAND, Layout } from '../src/components/Layout';
import { CtaButton, styles } from '../src/components/ui';

export interface RoleChangedEmailProps {
  /** Org in which the role changed. */
  organizationName: string;
  /** The new role the member now holds. */
  role: string;
  /** Who made the change, if known. */
  changedByName?: string | null;
  /** Link to the dashboard. */
  dashboardUrl: string;
}

/** Sent to a member when their role in an organization changes. */
export function RoleChangedEmail({
  organizationName,
  role,
  changedByName,
  dashboardUrl,
}: RoleChangedEmailProps) {
  const actor = changedByName ?? 'An administrator';
  return (
    <Layout preview={`Your role in ${organizationName} is now ${role}`}>
      <Text style={styles.heading}>Your role changed</Text>
      <Text style={styles.paragraph}>
        {actor} updated your role in <strong>{organizationName}</strong> on {BRAND.name}. You are
        now a <strong>{role}</strong>.
      </Text>
      <CtaButton href={dashboardUrl}>Open dashboard</CtaButton>
    </Layout>
  );
}

RoleChangedEmail.PreviewProps = {
  organizationName: 'Acme Inc',
  role: 'admin',
  changedByName: 'Alice',
  dashboardUrl: 'https://app.pinagent.dev/',
} satisfies RoleChangedEmailProps;

export default RoleChangedEmail;

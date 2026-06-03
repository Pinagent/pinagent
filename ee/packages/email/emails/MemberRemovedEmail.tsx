// SPDX-License-Identifier: Elastic-2.0
import { Text } from '@react-email/components';
import { BRAND, Layout } from '../src/components/Layout';
import { styles } from '../src/components/ui';

export interface MemberRemovedEmailProps {
  /** Org the recipient was removed from. */
  organizationName: string;
  /** Who removed them, if known. */
  removedByName?: string | null;
}

/** Sent to a member when they're removed from an organization. */
export function MemberRemovedEmail({ organizationName, removedByName }: MemberRemovedEmailProps) {
  const actor = removedByName ?? 'An administrator';
  return (
    <Layout preview={`You've been removed from ${organizationName}`}>
      <Text style={styles.heading}>Removed from {organizationName}</Text>
      <Text style={styles.paragraph}>
        {actor} removed your access to <strong>{organizationName}</strong> on {BRAND.name}. You no
        longer have access to its projects or sessions.
      </Text>
      <Text style={styles.muted}>
        If you think this was a mistake, contact an administrator of {organizationName}.
      </Text>
    </Layout>
  );
}

MemberRemovedEmail.PreviewProps = {
  organizationName: 'Acme Inc',
  removedByName: 'Alice',
} satisfies MemberRemovedEmailProps;

export default MemberRemovedEmail;

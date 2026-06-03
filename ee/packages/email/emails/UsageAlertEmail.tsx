// SPDX-License-Identifier: Elastic-2.0
import { Text } from '@react-email/components';
import { BRAND, Layout } from '../src/components/Layout';
import { CtaButton, styles } from '../src/components/ui';

export interface UsageAlertEmailProps {
  /** Org the alert is about. */
  organizationName: string;
  /** Human label for the metered resource, e.g. "relay sessions". */
  resource: string;
  /** Usage so far this period. */
  used: number;
  /** The cap (null = no numeric cap, e.g. a plan quota with a soft warning). */
  limit: number | null;
  /** `blocked` = issuance is being rejected; `warning` = approaching/over a soft cap. */
  severity: 'blocked' | 'warning';
  /** Link to the dashboard billing page. */
  billingUrl: string;
}

/** Sent to org admins when a usage cap is hit (blocked) or warned. */
export function UsageAlertEmail({
  organizationName,
  resource,
  used,
  limit,
  severity,
  billingUrl,
}: UsageAlertEmailProps) {
  const blocked = severity === 'blocked';
  const ofLimit = limit === null ? '' : ` of ${limit.toLocaleString()}`;
  return (
    <Layout
      preview={`${organizationName}: ${resource} ${blocked ? 'limit reached' : 'usage warning'}`}
    >
      <Text style={styles.heading}>
        {blocked ? `${resource} limit reached` : `${resource} usage warning`}
      </Text>
      <Text style={styles.paragraph}>
        <strong>{organizationName}</strong> has used {used.toLocaleString()}
        {ofLimit} {resource} this period on {BRAND.name}.{' '}
        {blocked
          ? 'New sessions are being blocked until the cap is raised or the period resets.'
          : 'You’re approaching the configured cap.'}
      </Text>
      <CtaButton href={billingUrl}>Review usage &amp; limits</CtaButton>
    </Layout>
  );
}

UsageAlertEmail.PreviewProps = {
  organizationName: 'Acme Inc',
  resource: 'relay sessions',
  used: 100,
  limit: 100,
  severity: 'blocked',
  billingUrl: 'https://app.pinagent.dev/billing',
} satisfies UsageAlertEmailProps;

export default UsageAlertEmail;

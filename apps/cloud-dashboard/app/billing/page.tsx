// SPDX-License-Identifier: Elastic-2.0
import { PageShell } from '../_components/PageShell';
import { BillingClient } from './BillingClient';

export const metadata = { title: 'Billing · Pinagent Cloud' };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return (
    <PageShell org={org} active="billing">
      {org ? <BillingClient organizationId={org} /> : null}
    </PageShell>
  );
}

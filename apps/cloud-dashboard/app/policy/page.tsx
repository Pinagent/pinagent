// SPDX-License-Identifier: Elastic-2.0
import { PageShell } from '../_components/PageShell';
import { PolicyClient } from './PolicyClient';

export const metadata = { title: 'Policy · Pinagent Cloud' };

export default async function PolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return (
    <PageShell org={org} active="policy">
      {org ? <PolicyClient organizationId={org} /> : null}
    </PageShell>
  );
}

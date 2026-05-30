// SPDX-License-Identifier: Elastic-2.0
import { PageShell } from '../_components/PageShell';
import { AuditClient } from './AuditClient';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return (
    <PageShell org={org} active="audit">
      {org ? <AuditClient organizationId={org} /> : null}
    </PageShell>
  );
}

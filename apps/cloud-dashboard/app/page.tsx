// SPDX-License-Identifier: Elastic-2.0
import { PageShell } from './_components/PageShell';
import { Dashboard } from './Dashboard';

/**
 * The active org is read from `?org=` so the dashboard is deep-linkable.
 * In Next 16 `searchParams` is async.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  return (
    <PageShell org={org} active="overview">
      {org ? <Dashboard organizationId={org} /> : null}
    </PageShell>
  );
}

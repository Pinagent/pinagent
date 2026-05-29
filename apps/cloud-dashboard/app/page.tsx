// SPDX-License-Identifier: Elastic-2.0
import { Dashboard } from './Dashboard';

/**
 * The active org is read from `?org=` so the dashboard is deep-linkable.
 * In Next 16 `searchParams` is async.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Pinagent Cloud</h1>
        {org ? <span className="org-id">{org}</span> : null}
      </header>
      {org ? (
        <Dashboard organizationId={org} />
      ) : (
        <p className="empty">
          No organization selected. Append <code>?org=&lt;id&gt;</code> to the URL.
        </p>
      )}
    </main>
  );
}

// SPDX-License-Identifier: Elastic-2.0
import { useMemo } from 'react';
import { createCloudApiClient } from './api-client';
import { Overview } from './Overview';

/** Reads the active org from `?org=` so the dashboard is deep-linkable. */
function readOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('org');
}

export function App() {
  const client = useMemo(() => createCloudApiClient(), []);
  const organizationId = readOrganizationId();

  return (
    <main className="app">
      <header className="app-header">
        <h1>Pinagent Cloud</h1>
        {organizationId ? <span className="org-id">{organizationId}</span> : null}
      </header>
      {organizationId ? (
        <Overview client={client} organizationId={organizationId} />
      ) : (
        <p className="empty">
          No organization selected. Append <code>?org=&lt;id&gt;</code> to the URL.
        </p>
      )}
    </main>
  );
}

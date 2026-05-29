// SPDX-License-Identifier: Elastic-2.0
import type { ReactNode } from 'react';
import { Nav, type NavTab } from './Nav';

/**
 * Shared page chrome: header, nav, and the no-org guard. Pages pass the
 * org (read from `searchParams`) and their active tab; `children` renders
 * only when an org is selected.
 */
export function PageShell({
  org,
  active,
  children,
}: {
  org?: string;
  active: NavTab;
  children: ReactNode;
}) {
  return (
    <main className="app">
      <header className="app-header">
        <h1>Pinagent Cloud</h1>
        {org ? <span className="org-id">{org}</span> : null}
      </header>
      <Nav org={org} active={active} />
      {org ? (
        children
      ) : (
        <p className="empty">
          No organization selected. Append <code>?org=&lt;id&gt;</code> to the URL.
        </p>
      )}
    </main>
  );
}

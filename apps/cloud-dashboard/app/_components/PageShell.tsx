// SPDX-License-Identifier: Elastic-2.0
import type { ReactNode } from 'react';
import { Nav, type NavTab, pathForTab } from './Nav';
import { OrgGate } from './OrgGate';
import { OrgSwitcher } from './OrgSwitcher';

/**
 * Shared page chrome: header (with the org switcher), nav, and the no-org
 * gate. Pages pass the org (read from `?org=`) and their active tab.
 * `children` renders for the selected org; with no org, the gate resolves the
 * caller's orgs and redirects to a default.
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
  const basePath = pathForTab(active);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Pinagent Cloud</h1>
        {org ? <OrgSwitcher activeOrg={org} basePath={basePath} /> : null}
      </header>
      <Nav org={org} active={active} />
      {org ? children : <OrgGate basePath={basePath} />}
    </main>
  );
}

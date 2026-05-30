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
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Pinagent Cloud</h1>
        {org ? (
          <span className="rounded-full bg-secondary px-3 py-1 font-mono text-xs text-secondary-foreground">
            {org}
          </span>
        ) : null}
      </header>
      <Nav org={org} active={active} />
      {org ? (
        children
      ) : (
        <p className="text-sm text-muted-foreground">
          No organization selected. Append <code className="font-mono">?org=&lt;id&gt;</code> to the
          URL.
        </p>
      )}
    </main>
  );
}

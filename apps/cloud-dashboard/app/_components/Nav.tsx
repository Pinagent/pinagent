// SPDX-License-Identifier: Elastic-2.0

export type NavTab = 'overview' | 'billing' | 'policy' | 'audit';

const TABS: ReadonlyArray<{ id: NavTab; label: string; path: string }> = [
  { id: 'overview', label: 'Overview', path: '/' },
  { id: 'billing', label: 'Billing', path: '/billing' },
  { id: 'policy', label: 'Policy', path: '/policy' },
  { id: 'audit', label: 'Audit', path: '/audit' },
];

/** Builds an href that preserves the active org as a query param. */
function hrefFor(path: string, org?: string): string {
  return org ? `${path}?org=${encodeURIComponent(org)}` : path;
}

export function Nav({ org, active }: { org?: string; active: NavTab }) {
  return (
    <nav className="nav">
      {TABS.map((tab) => (
        <a
          key={tab.id}
          className={tab.id === active ? 'nav-link nav-link-active' : 'nav-link'}
          aria-current={tab.id === active ? 'page' : undefined}
          href={hrefFor(tab.path, org)}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

// SPDX-License-Identifier: Elastic-2.0
import { cn } from '@pinagent/ui/lib/utils';

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
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <a
            key={tab.id}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-current={isActive ? 'page' : undefined}
            href={hrefFor(tab.path, org)}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}

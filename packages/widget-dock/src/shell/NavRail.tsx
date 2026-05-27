// SPDX-License-Identifier: Apache-2.0
/**
 * Left-side icon nav rail for the dock. Icon-only at panel widths
 * (≤480px); icon + label at ≥640px (floating, fullscreen).
 *
 * Routes navigate through TanStack Router so URL state stays in sync —
 * embedded mode uses memory history (no leak into the iframe URL bar),
 * standalone uses browser history so deep links work.
 */

import { cn } from '@pinagent/ui/lib/utils';
import { Link, useLocation } from '@tanstack/react-router';
import {
  Activity,
  GitBranch,
  GitPullRequest,
  History as HistoryIcon,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
} from 'lucide-react';
import type { ComponentType, SVGAttributes } from 'react';
import { ROUTE_PATHS, type RouteKey, type RoutePath } from '../route-paths';

export interface RouteDescriptor {
  key: RouteKey;
  path: RoutePath;
  label: string;
  Icon: ComponentType<SVGAttributes<SVGSVGElement>>;
  /** Optional indicator value (e.g. pending change count). */
  count?: number;
}

export const ROUTES: readonly RouteDescriptor[] = [
  { key: 'overview', path: ROUTE_PATHS.overview, label: 'Overview', Icon: LayoutDashboard },
  {
    key: 'conversations',
    path: ROUTE_PATHS.conversations,
    label: 'Conversations',
    Icon: MessageSquare,
  },
  { key: 'changes', path: ROUTE_PATHS.changes, label: 'Changes', Icon: Activity },
  { key: 'branches', path: ROUTE_PATHS.branches, label: 'Branches', Icon: GitBranch },
  { key: 'prs', path: ROUTE_PATHS.prs, label: 'PRs', Icon: GitPullRequest },
  { key: 'connections', path: ROUTE_PATHS.connections, label: 'Connections', Icon: Plug },
  { key: 'settings', path: ROUTE_PATHS.settings, label: 'Settings', Icon: Settings },
  { key: 'history', path: ROUTE_PATHS.history, label: 'History', Icon: HistoryIcon },
] as const;

export interface NavRailProps {
  /** Show labels alongside icons (force on for floating/fullscreen). */
  expanded?: boolean;
  className?: string;
}

export function NavRail({ expanded = false, className }: NavRailProps) {
  const location = useLocation();
  return (
    <nav
      aria-label="Dock navigation"
      className={cn(
        'flex flex-col gap-0.5 border-r border-border bg-card py-2',
        expanded ? 'w-[180px] px-2' : 'w-12 items-center px-1',
        className,
      )}
    >
      {ROUTES.map(({ key, path, label, Icon, count }) => {
        const isActive = location.pathname === path;
        return (
          <Link
            key={key}
            to={path}
            aria-current={isActive ? 'page' : undefined}
            title={expanded ? undefined : label}
            className={cn(
              'group flex items-center gap-2.5 rounded-md text-sm font-medium relative',
              'transition-colors',
              expanded ? 'h-9 w-full px-2.5 justify-start' : 'h-10 w-10 justify-center',
              isActive
                ? 'bg-secondary text-secondary-foreground shadow-[inset_0_0_0_1px_var(--border)]'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                'h-4 w-4 shrink-0',
                isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
              )}
            />
            {expanded && <span className="truncate">{label}</span>}
            {count !== undefined && count > 0 && (
              <span
                role="status"
                aria-label={`${count} pending`}
                className={cn(
                  'ml-auto inline-flex items-center justify-center rounded-full',
                  'bg-accent text-accent-foreground text-[10px] font-semibold leading-none',
                  'min-w-[16px] h-[16px] px-1',
                  expanded ? '' : 'absolute -top-0.5 -right-0.5',
                )}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

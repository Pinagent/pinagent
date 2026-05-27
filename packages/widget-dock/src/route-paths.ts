// SPDX-License-Identifier: Apache-2.0
/**
 * Route path constants — kept in a leaf module so they can be imported
 * by both `router.tsx` and the shell components (NavRail, keyboard
 * shortcuts) without forming an import cycle. The cycle previously was
 * router → DockShell → NavRail → router, which left `ROUTE_PATHS`
 * undefined when NavRail's top-level `ROUTES` const evaluated in the
 * bundled build — throwing a TypeError before the dock could mount.
 */

export const ROUTE_PATHS = {
  overview: '/',
  conversations: '/conversations',
  changes: '/changes',
  branches: '/branches',
  prs: '/prs',
  connections: '/connections',
  settings: '/settings',
  history: '/history',
} as const;

export type RouteKey = keyof typeof ROUTE_PATHS;
export type RoutePath = (typeof ROUTE_PATHS)[RouteKey];

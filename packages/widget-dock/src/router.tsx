// SPDX-License-Identifier: Apache-2.0
/**
 * TanStack Router setup — code-based, no router plugin. Routes are
 * declared explicitly here; route components live in src/routes/.
 *
 * The shell (FAB + chrome + nav + outlet) lives on the root route.
 * Each top-level route renders into the shell's `<Outlet />`. History
 * is injected per entry point — memory history in the embedded iframe
 * (URL doesn't belong to the user), browser history in the future
 * standalone dashboard build (deep-linkable).
 *
 * `Router` type is re-exported under our own name so consumers don't
 * have to learn TanStack's internal generic-stamping ritual.
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
  type Router as TsrRouter,
} from '@tanstack/react-router';
import { Branches } from './routes/Branches';
import { Changes } from './routes/Changes';
import { Connections } from './routes/Connections';
import { Conversations } from './routes/Conversations';
import { History } from './routes/History';
import { Overview } from './routes/Overview';
import { PRs } from './routes/PRs';
import { Settings } from './routes/Settings';
import { DockShell } from './shell/DockShell';

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

const rootRoute = createRootRoute({
  component: DockShell,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.overview,
  component: Overview,
});
const conversationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.conversations,
  component: Conversations,
});
const changesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.changes,
  component: Changes,
});
const branchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.branches,
  component: Branches,
});
const prsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.prs,
  component: PRs,
});
const connectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.connections,
  component: Connections,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.settings,
  component: Settings,
});
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.history,
  component: History,
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  conversationsRoute,
  changesRoute,
  branchesRoute,
  prsRoute,
  connectionsRoute,
  settingsRoute,
  historyRoute,
]);

export type DockRouter = TsrRouter<typeof routeTree>;

export function createDockRouter(history: RouterHistory): DockRouter {
  return createRouter({ routeTree, history });
}

// TanStack Router infers the registered router type from this module
// augmentation. Single-router app — one global Register is fine.
declare module '@tanstack/react-router' {
  interface Register {
    router: DockRouter;
  }
}

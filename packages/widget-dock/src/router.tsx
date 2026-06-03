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
 * Code-split per route: every screen except Overview (the default
 * landing) is loaded on demand via React.lazy. A single Suspense
 * boundary inside DockShell catches the pending state and shows a
 * tiny loading indicator. Drops the initial bundle by ~40 KB gz.
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
import { lazy } from 'react';
import { ROUTE_PATHS } from './route-paths';
import { validateComposeSearch } from './routes/compose-search';
import { validateConversationsSearch } from './routes/conversations-search';
import { Overview } from './routes/Overview';
import { validatePreviewSearch } from './routes/preview-search';
import { validatePrsSearch } from './routes/prs-search';
import { DockShell } from './shell/DockShell';

// Eager: Overview is the default landing route — splitting it would
// just delay first paint without saving anything on the typical open.
//
// Lazy: every other screen. Bundled per-route by Vite/rollup; the
// Suspense boundary lives in DockShell so swapping routes shows a
// uniform pending state instead of seven different fallbacks.
const Conversations = lazy(() =>
  import('./routes/Conversations').then((m) => ({ default: m.Conversations })),
);
const Changes = lazy(() => import('./routes/Changes').then((m) => ({ default: m.Changes })));
const Branches = lazy(() => import('./routes/Branches').then((m) => ({ default: m.Branches })));
const WorktreePreview = lazy(() =>
  import('./routes/WorktreePreview').then((m) => ({ default: m.WorktreePreview })),
);
const PRs = lazy(() => import('./routes/PRs').then((m) => ({ default: m.PRs })));
const NewPullRequest = lazy(() =>
  import('./routes/NewPullRequest').then((m) => ({ default: m.NewPullRequest })),
);
const Connections = lazy(() =>
  import('./routes/Connections').then((m) => ({ default: m.Connections })),
);
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })));
const History = lazy(() => import('./routes/History').then((m) => ({ default: m.History })));

export { ROUTE_PATHS, type RouteKey, type RoutePath } from './route-paths';

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
  /**
   * `?id=<conversation-id>` opens the detail view for that conversation
   * inline. Empty / absent → list view. The route itself stays a single
   * path so the list+detail share state (filters, query, scroll) when
   * the user backs out of detail. Logic lives in
   * `routes/conversations-search.ts` so it can be unit-tested without
   * the full router tree.
   */
  validateSearch: validateConversationsSearch,
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
const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.preview,
  component: WorktreePreview,
  /**
   * `?id=<conversation-id>` selects which worktree to preview — set by the
   * Branches "Open in dock" action and updated as the user switches, so
   * the active selection is deep-linkable and survives in-dock nav.
   */
  validateSearch: validatePreviewSearch,
});
const prsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.prs,
  component: PRs,
  /**
   * `?number=<pr-number>` scrolls that PR into view and briefly
   * highlights it — set when the activity feed deep-links a
   * `pr_created` row into this tab. Absent → the list renders normally.
   * Parsing lives in `routes/prs-search.ts` so it can be unit-tested
   * without the router tree.
   */
  validateSearch: validatePrsSearch,
});
const prsNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.prsNew,
  component: NewPullRequest,
  /**
   * `?ids=a,b,c` pre-checks those conversations in the picker — set when
   * entering from the Changes multi-select. Absent → nothing pre-checked
   * (the cold entry from the PRs tab). Parsing lives in
   * `routes/compose-search.ts` so it can be unit-tested without the
   * router tree.
   */
  validateSearch: validateComposeSearch,
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
  previewRoute,
  prsRoute,
  prsNewRoute,
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

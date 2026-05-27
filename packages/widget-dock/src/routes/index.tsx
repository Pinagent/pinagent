// SPDX-License-Identifier: Apache-2.0
/**
 * Route placeholders. Phase 5 replaces these with real screens and
 * fixture data; for now they validate the dock chrome + nav at all
 * three layouts.
 */
import type { ReactElement } from 'react';
import type { RouteKey } from '../shell/NavRail';
import { ROUTES } from '../shell/NavRail';
import { EmptyState } from '../shell/states';

function Placeholder({ routeKey }: { routeKey: RouteKey }) {
  const route = ROUTES.find((r) => r.key === routeKey);
  return (
    <EmptyState
      title={route?.label ?? routeKey}
      description={
        <>
          This view ships in Phase 5 of the redesign. Today it just confirms the
          chrome, nav, and layout modes render correctly.
        </>
      }
    />
  );
}

export const ROUTE_VIEWS: Record<RouteKey, () => ReactElement> = {
  overview: () => <Placeholder routeKey="overview" />,
  conversations: () => <Placeholder routeKey="conversations" />,
  changes: () => <Placeholder routeKey="changes" />,
  branches: () => <Placeholder routeKey="branches" />,
  prs: () => <Placeholder routeKey="prs" />,
  connections: () => <Placeholder routeKey="connections" />,
  settings: () => <Placeholder routeKey="settings" />,
  history: () => <Placeholder routeKey="history" />,
};

// SPDX-License-Identifier: Apache-2.0
/**
 * Route map. Three routes ship with real fixture-driven screens
 * (Overview, Conversations, Changes) — they validate the visual
 * language end-to-end. The rest use the EmptyState placeholder for
 * now; they share the same primitives (ListRow, StatusBadge,
 * AnchorChip), so the build-out is straightforward once Phase 5
 * lands.
 */

import { Activity, GitBranch, GitPullRequest, History, Plug, Settings } from 'lucide-react';
import type { ReactElement } from 'react';
import type { RouteKey } from '../shell/NavRail';
import { ROUTES } from '../shell/NavRail';
import { EmptyState } from '../shell/states';
import { Changes } from './Changes';
import { Conversations } from './Conversations';
import { Overview } from './Overview';

function Placeholder({ routeKey }: { routeKey: RouteKey }) {
  const route = ROUTES.find((r) => r.key === routeKey);
  const Icon =
    routeKey === 'branches'
      ? GitBranch
      : routeKey === 'prs'
        ? GitPullRequest
        : routeKey === 'connections'
          ? Plug
          : routeKey === 'settings'
            ? Settings
            : routeKey === 'history'
              ? History
              : Activity;
  return (
    <EmptyState
      Icon={Icon}
      title={route?.label ?? routeKey}
      description={
        <>
          This view shares the same primitives as Overview, Conversations, and Changes. Designing it
          out is a follow-up once the visual language is approved.
        </>
      }
    />
  );
}

export const ROUTE_VIEWS: Record<RouteKey, () => ReactElement> = {
  overview: () => <Overview />,
  conversations: () => <Conversations />,
  changes: () => <Changes />,
  branches: () => <Placeholder routeKey="branches" />,
  prs: () => <Placeholder routeKey="prs" />,
  connections: () => <Placeholder routeKey="connections" />,
  settings: () => <Placeholder routeKey="settings" />,
  history: () => <Placeholder routeKey="history" />,
};

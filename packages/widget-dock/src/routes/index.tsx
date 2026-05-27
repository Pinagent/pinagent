// SPDX-License-Identifier: Apache-2.0
/**
 * Route map. All eight Phase 1 routes ship as read-only screens. Write
 * actions are deferred per phase: Changes batch → Phase 3 (PR composer),
 * Branches prune → Phase 4 (worktree management), Connections /
 * Settings writes → Phase 5, History full-text + audit log → Phase 6.
 * The placeholder shape is gone; each route owns its own screen now.
 */

import type { ReactElement } from 'react';
import type { RouteKey } from '../shell/NavRail';
import { Branches } from './Branches';
import { Changes } from './Changes';
import { Connections } from './Connections';
import { Conversations } from './Conversations';
import { History } from './History';
import { Overview } from './Overview';
import { PRs } from './PRs';
import { Settings } from './Settings';

export const ROUTE_VIEWS: Record<RouteKey, () => ReactElement> = {
  overview: () => <Overview />,
  conversations: () => <Conversations />,
  changes: () => <Changes />,
  branches: () => <Branches />,
  prs: () => <PRs />,
  connections: () => <Connections />,
  settings: () => <Settings />,
  history: () => <History />,
};

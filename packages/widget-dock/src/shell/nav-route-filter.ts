// SPDX-License-Identifier: Apache-2.0
/**
 * Filter the dock's nav-rail routes based on which worktree-flow views
 * have any data to show. Branches, Changes, and PRs only make sense when
 * the project is actually producing those rows — on an MCP-runtime or
 * inline-mode setup they stay permanently empty and become misleading
 * dead nav. The active route is always kept visible so the user can't
 * get stranded if a list empties while they're looking at it.
 *
 * Pure — takes counts and the current path, returns the visible subset.
 * Lives outside NavRail/DockShell so the filtering rule is unit-testable
 * without rendering the dock.
 */
import type { RouteDescriptor } from './NavRail';

export interface NavRouteCounts {
  branches: number;
  changes: number;
  prs: number;
}

export interface FilterNavRoutesInput {
  routes: readonly RouteDescriptor[];
  counts: NavRouteCounts;
  activePath: string;
}

const HIDE_WHEN_EMPTY_KEYS = new Set(['branches', 'changes', 'preview', 'prs']);

export function filterNavRoutes({
  routes,
  counts,
  activePath,
}: FilterNavRoutesInput): readonly RouteDescriptor[] {
  return routes.filter((route) => {
    if (!HIDE_WHEN_EMPTY_KEYS.has(route.key)) return true;
    if (route.path === activePath) return true;
    switch (route.key) {
      case 'branches':
        return counts.branches > 0;
      case 'changes':
        return counts.changes > 0;
      // Preview only makes sense when there are worktrees to preview, so
      // gate it on the same branch count.
      case 'preview':
        return counts.branches > 0;
      case 'prs':
        return counts.prs > 0;
      default:
        return true;
    }
  });
}

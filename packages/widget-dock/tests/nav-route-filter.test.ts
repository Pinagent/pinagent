// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the worktree-flow tab gating: Branches, Changes, and PRs hide
 * when their underlying list is empty, *unless* the user is currently
 * on that route (we don't want to yank the active tab out from under
 * them mid-look). All other routes always render.
 */
import { describe, expect, it } from 'vitest';
import type { RouteDescriptor } from '../src/shell/NavRail';
import { ROUTES } from '../src/shell/NavRail';
import { filterNavRoutes } from '../src/shell/nav-route-filter';

function keysOf(routes: readonly RouteDescriptor[]): string[] {
  return routes.map((r) => r.key);
}

const ALL_EMPTY = { branches: 0, changes: 0, prs: 0 };
const ALL_NON_EMPTY = { branches: 3, changes: 2, prs: 1 };

describe('filterNavRoutes', () => {
  it('keeps every route when worktree-flow lists have data', () => {
    const out = filterNavRoutes({
      routes: ROUTES,
      counts: ALL_NON_EMPTY,
      activePath: '/',
    });
    expect(keysOf(out)).toEqual(keysOf(ROUTES));
  });

  it('hides branches, changes, prs when their lists are empty', () => {
    const out = filterNavRoutes({
      routes: ROUTES,
      counts: ALL_EMPTY,
      activePath: '/',
    });
    expect(keysOf(out)).not.toContain('branches');
    expect(keysOf(out)).not.toContain('changes');
    expect(keysOf(out)).not.toContain('prs');
  });

  it('always keeps overview, conversations, connections, settings, history', () => {
    const out = filterNavRoutes({
      routes: ROUTES,
      counts: ALL_EMPTY,
      activePath: '/',
    });
    expect(keysOf(out)).toEqual([
      'overview',
      'conversations',
      'connections',
      'settings',
      'history',
    ]);
  });

  it('keeps the active route even when its list is empty', () => {
    const branchesRoute = ROUTES.find((r) => r.key === 'branches');
    if (!branchesRoute) throw new Error('test setup: branches route missing');
    const out = filterNavRoutes({
      routes: ROUTES,
      counts: ALL_EMPTY,
      activePath: branchesRoute.path,
    });
    expect(keysOf(out)).toContain('branches');
    // …but the other two empty flow tabs still hide.
    expect(keysOf(out)).not.toContain('changes');
    expect(keysOf(out)).not.toContain('prs');
  });

  it('treats Infinity (loading) as non-empty so tabs do not flash hidden', () => {
    const out = filterNavRoutes({
      routes: ROUTES,
      counts: {
        branches: Number.POSITIVE_INFINITY,
        changes: Number.POSITIVE_INFINITY,
        prs: Number.POSITIVE_INFINITY,
      },
      activePath: '/',
    });
    expect(keysOf(out)).toEqual(keysOf(ROUTES));
  });

  it('mixes empty + non-empty correctly', () => {
    const out = filterNavRoutes({
      routes: ROUTES,
      counts: { branches: 0, changes: 5, prs: 0 },
      activePath: '/',
    });
    expect(keysOf(out)).toContain('changes');
    expect(keysOf(out)).not.toContain('branches');
    expect(keysOf(out)).not.toContain('prs');
  });
});

// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Render-level pin for the `/prs/new` composer route. The picker and the
 * compose hand-off have real wiring (search-param seeding, the
 * picked→Composer snapshot, the createPullRequest submit) that the unit
 * tests for `compose-search` can't reach. This mounts the route in a
 * minimal router with a spying transport and walks the happy path:
 *
 *   1. ready-to-land conversations render as a checklist,
 *   2. `?ids=` pre-checks the matching rows,
 *   3. Continue → Composer → "Create PR" submits the picked feedbackIds.
 *
 * Uses the same raw `createRoot` + `act` harness as the StreamView test
 * (the package has no @testing-library), plus a real-timer flush so the
 * MockTransport's simulated latency settles.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateComposeSearch } from '../src/routes/compose-search';
import { NewPullRequest } from '../src/routes/NewPullRequest';
import {
  type CreatePullRequestInput,
  type CreatePullRequestResult,
  MockTransport,
  TransportProvider,
} from '../src/transport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** MockTransport that records createPullRequest calls and resolves instantly. */
class SpyTransport extends MockTransport {
  prCalls: CreatePullRequestInput[] = [];
  override async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<CreatePullRequestResult> {
    this.prCalls.push(input);
    return { ok: true, branchPushed: true, prUrl: 'https://github.com/x/y/pull/1' };
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Let React Query's fetches (simulated latency) and renders settle. */
async function settle(ms = 250): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function renderRoute(initialUrl: string, transport: MockTransport): void {
  const rootRoute = createRootRoute({ component: Outlet });
  const prsNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/prs/new',
    component: NewPullRequest,
    validateSearch: validateComposeSearch,
  });
  const prsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/prs',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([prsNewRoute, prsRoute]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <TransportProvider transport={transport}>
          {/* Minimal router isn't the registered DockRouter type; cast at the boundary. */}
          <RouterProvider router={router as never} />
        </TransportProvider>
      </QueryClientProvider>,
    );
  });
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="checkbox"]'));
}

function buttonByText(re: RegExp): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  const found = btns.find((b) => re.test((b.textContent ?? '').trim()));
  if (!found) {
    throw new Error(
      `button matching ${re} not found; buttons: ${btns.map((b) => `"${b.textContent?.trim()}"`).join(', ')}`,
    );
  }
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('NewPullRequest route', () => {
  it('lists ready-to-land conversations as a checklist', async () => {
    renderRoute('/prs/new', new SpyTransport());
    await settle();
    // Fixtures have three readyToLand changes (ch_01/02/03); the pending
    // and errored ones are excluded.
    expect(checkboxes()).toHaveLength(3);
    expect(checkboxes().every((c) => !c.checked)).toBe(true);
  });

  it('pre-checks the rows named in ?ids=', async () => {
    renderRoute('/prs/new?ids=cv_03,cv_12', new SpyTransport());
    await settle();
    const checked = checkboxes().filter((c) => c.checked);
    expect(checked).toHaveLength(2);
  });

  it('Continue → Composer → Create PR submits the picked feedbackIds', async () => {
    const transport = new SpyTransport();
    renderRoute('/prs/new?ids=cv_03,cv_12', transport);
    await settle();

    await click(buttonByText(/^Continue$/));
    await settle();
    // Composer mounted: branch/title pre-filled, so the submit is enabled.
    await click(buttonByText(/Create PR/));
    await settle();

    expect(transport.prCalls).toHaveLength(1);
    expect(new Set(transport.prCalls[0]!.feedbackIds)).toEqual(new Set(['cv_03', 'cv_12']));
  });
});

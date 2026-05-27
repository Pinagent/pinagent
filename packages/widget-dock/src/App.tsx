// SPDX-License-Identifier: Apache-2.0
/**
 * Dev sample app. Renders the dock as it'll appear embedded on a host
 * page, with real data from the local pinagent dev-server (proxied
 * through Vite in dev) — or fixtures when invoked with `?fixtures=on`.
 *
 * URL flags:
 *   ?fixtures=on              — swap in MockTransport so the visual
 *                               story stays reviewable without a host
 *                               backend running.
 *   ?state=disconnected       — force the disconnected chrome indicator
 *                               for design review.
 *   ?embedded=on              — render in embedded mode (no host
 *                               backdrop). Real dock loads this way.
 *
 * Routing uses TanStack Router with browser history. The embedded /
 * standalone entry points (Phase 7) wire dedicated history backends
 * and skip this dev-preview App entirely.
 */
import { createBrowserHistory, RouterProvider } from '@tanstack/react-router';
import { useMemo } from 'react';
import { QueryProvider } from './hooks/QueryProvider';
import { createDockRouter } from './router';
import { DockEnvironmentProvider } from './shell/DockEnvironment';
import { type DockTransport, LocalTransport, MockTransport, TransportProvider } from './transport';

function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function App() {
  const params = useMemo(readParams, []);
  // Accept `on`, `true`, `1` so the documented `?fixtures=on` works and the
  // common typo `?fixtures=true` no longer silently no-ops. Same for embedded.
  const fixturesParam = params.get('fixtures');
  const useFixtures = fixturesParam === 'on' || fixturesParam === 'true' || fixturesParam === '1';
  const embeddedParam = params.get('embedded');
  const embedded = embeddedParam === 'on' || embeddedParam === 'true' || embeddedParam === '1';
  const forcedDisconnected = params.get('state') === 'disconnected';

  const transport = useMemo<DockTransport>(
    () => (useFixtures ? new MockTransport() : new LocalTransport()),
    [useFixtures],
  );

  // Dev preview always uses browser history. The real iframe-embedded
  // build will use memory history from its dedicated entry point.
  const router = useMemo(() => createDockRouter(createBrowserHistory()), []);

  return (
    <QueryProvider>
      <TransportProvider transport={transport}>
        <DockEnvironmentProvider embedded={embedded} forcedDisconnected={forcedDisconnected}>
          <RouterProvider router={router} />
        </DockEnvironmentProvider>
      </TransportProvider>
    </QueryProvider>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Embedded entry — the dock as it actually ships to host pages, loaded
 * by `@pinagent/vite-plugin` / `@pinagent/next-plugin` into a fixed
 * full-viewport iframe.
 *
 * Differences from the dev preview (`main.tsx`):
 *   - No host backdrop. The host page IS the backdrop; body is
 *     transparent / click-through via the [data-pinagent-embedded]
 *     attribute in globals.css.
 *   - Memory history. The iframe URL bar isn't user-visible — there's
 *     nothing for the user to deep-link to from there. Navigation
 *     stays in-process; the host can postMessage to the iframe to
 *     drive route changes once the embedded transport ships.
 *   - No widget IIFE side-load. The host page mounts the widget
 *     separately; loading it here would be a double-mount.
 */
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryProvider } from '../hooks/QueryProvider';
import { createDockRouter } from '../router';
import { DockEnvironmentProvider } from '../shell/DockEnvironment';
import type { DockTransport } from '../transport';
import { LocalTransport, MockTransport, TransportProvider } from '../transport';
import '../styles/globals.css';
import { startLayoutBroadcaster } from './layout-broadcaster';

document.documentElement.dataset.pinagentEmbedded = 'true';

const params = new URLSearchParams(window.location.search);
// Accept `on`, `true`, `1` so the documented `?fixtures=on` works and the
// common typo `?fixtures=true` no longer silently no-ops.
const fixturesParam = params.get('fixtures');
const useFixtures = fixturesParam === 'on' || fixturesParam === 'true' || fixturesParam === '1';
const forcedDisconnected = params.get('state') === 'disconnected';

const transport: DockTransport = useFixtures ? new MockTransport() : new LocalTransport();
const router = createDockRouter(createMemoryHistory({ initialEntries: ['/'] }));

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryProvider>
      <TransportProvider transport={transport}>
        <DockEnvironmentProvider embedded forcedDisconnected={forcedDisconnected}>
          <RouterProvider router={router} />
        </DockEnvironmentProvider>
      </TransportProvider>
    </QueryProvider>
  </React.StrictMode>,
);

// Broadcast the FAB / surface / backdrop rects to the host bridge so it
// can toggle the iframe's pointer-events. Without this, the iframe is
// either always click-through (FAB unreachable) or always interactive
// (host clicks blocked) — neither acceptable.
startLayoutBroadcaster();

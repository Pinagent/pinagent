// SPDX-License-Identifier: Apache-2.0
/**
 * Standalone entry — the dock as it'll ship from the hosted dashboard
 * at app.pinagent.io/projects/:id/dock/... (Phase 7+). Loaded directly
 * by the hosted app's HTML, not via an iframe.
 *
 * Differences from the embedded entry:
 *   - Browser history. URL is user-visible; deep links and back/forward
 *     work. Hosted dashboard's framework is expected to serve this
 *     bundle on any sub-path (SPA fallback) so client routing wins.
 *   - No `embedded` flag. Body styles render the dock at full-bleed.
 *   - StandaloneTransport will replace LocalTransport once the hosted
 *     relay exists; until then this entry uses LocalTransport for
 *     development against a local dev-server.
 */
import { createBrowserHistory, RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryProvider } from '../hooks/QueryProvider';
import { createDockRouter } from '../router';
import { DockEnvironmentProvider } from '../shell/DockEnvironment';
import type { DockTransport } from '../transport';
import { LocalTransport, MockTransport, TransportProvider } from '../transport';
import '../styles/globals.css';

const params = new URLSearchParams(window.location.search);
// Accept `on`, `true`, `1` — see embedded.tsx for the rationale.
const fixturesParam = params.get('fixtures');
const useFixtures = fixturesParam === 'on' || fixturesParam === 'true' || fixturesParam === '1';
const forcedDisconnected = params.get('state') === 'disconnected';

const transport: DockTransport = useFixtures ? new MockTransport() : new LocalTransport();
const router = createDockRouter(createBrowserHistory());

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryProvider>
      <TransportProvider transport={transport}>
        <DockEnvironmentProvider embedded={false} forcedDisconnected={forcedDisconnected}>
          <RouterProvider router={router} />
        </DockEnvironmentProvider>
      </TransportProvider>
    </QueryProvider>
  </React.StrictMode>,
);

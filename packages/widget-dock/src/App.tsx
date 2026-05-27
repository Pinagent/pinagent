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
 */

import { PinMark } from '@pinagent/ui/components/pin-mark';
import { useMemo, useState } from 'react';
import { QueryProvider } from './hooks/QueryProvider';
import { useConversations } from './hooks/useConversations';
import { ROUTE_VIEWS } from './routes';
import { DockChrome } from './shell/DockChrome';
import { DockFAB } from './shell/DockFAB';
import { DockSurface } from './shell/DockSurface';
import { NavRail, type RouteKey } from './shell/NavRail';
import { useDockMode } from './shell/useDockMode';
import { type DockTransport, LocalTransport, MockTransport, TransportProvider } from './transport';

function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function App() {
  const params = useMemo(readParams, []);
  const useFixtures = params.get('fixtures') === 'on';
  const transport = useMemo<DockTransport>(
    () => (useFixtures ? new MockTransport() : new LocalTransport()),
    [useFixtures],
  );

  return (
    <QueryProvider>
      <TransportProvider transport={transport}>
        <DockShell params={params} transportKind={transport.kind} />
      </TransportProvider>
    </QueryProvider>
  );
}

function DockShell({
  params,
  transportKind,
}: {
  params: URLSearchParams;
  transportKind: DockTransport['kind'];
}) {
  const dock = useDockMode();
  const [activeRoute, setActiveRoute] = useState<RouteKey>('overview');
  const forcedDisconnected = params.get('state') === 'disconnected';

  // The FAB count badge tracks anything the user might want to act on:
  // ready-to-land changes + conversations awaiting their reply. Reads
  // the same conversations cache the Overview/Conversations views use,
  // so it stays in sync without an extra fetch.
  const conversations = useConversations();
  const pendingCount = useMemo(() => {
    const data = conversations.data ?? [];
    return data.filter((c) => c.status === 'readyToLand' || c.status === 'awaitingClarification')
      .length;
  }, [conversations.data]);

  // If the local transport can't reach the dev-server, surface that as
  // a chrome indicator alongside the forced state flag.
  const transportDisconnected =
    transportKind === 'local' && conversations.isError && !conversations.isLoading;
  const disconnected = forcedDisconnected || transportDisconnected;

  const expandedNav = dock.mode !== 'panel';
  const ActiveView = ROUTE_VIEWS[activeRoute];
  const context = transportKind === 'mock' ? 'fixtures' : 'pinagent-demo';

  return (
    <div className="min-h-svh bg-background text-foreground antialiased font-sans">
      <HostBackdrop transportKind={transportKind} />

      <DockFAB open={dock.open} count={pendingCount} onToggle={dock.toggle} />

      <DockSurface open={dock.open} mode={dock.mode} embedded>
        <DockChrome
          mode={dock.mode}
          onModeChange={dock.setMode}
          onClose={() => dock.setOpen(false)}
          disconnected={disconnected}
          context={context}
        />
        <div className="flex flex-1 min-h-0">
          <NavRail active={activeRoute} onSelect={setActiveRoute} expanded={expandedNav} />
          <main className="flex flex-1 flex-col overflow-auto">
            <ActiveView />
          </main>
        </div>
      </DockSurface>
    </div>
  );
}

/**
 * Stand-in for a host page so the dock has something to look like it's
 * embedded in. The header copy adapts to which transport is active so
 * the demo reads honestly in both modes.
 */
function HostBackdrop({ transportKind }: { transportKind: DockTransport['kind'] }) {
  const isMock = transportKind === 'mock';
  return (
    <div className="absolute inset-0 overflow-hidden -z-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,#F5EFD0_0%,transparent_55%),radial-gradient(circle_at_80%_70%,#F5EFD0_0%,transparent_50%)]" />
      <div className="container mx-auto max-w-4xl px-8 pt-24">
        <div className="flex items-center gap-3 text-muted-foreground">
          <PinMark size="sm" tone="ink" />
          <span className="text-xs uppercase tracking-wider">
            Pinagent dock — dev preview {isMock && '· fixtures'}
          </span>
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          Click the pin to open the dock.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground leading-relaxed">
          {isMock ? (
            <>
              Running with fixture data — no host backend required. Remove{' '}
              <code className="font-mono">?fixtures=on</code> to read from a local pinagent
              dev-server instead.
            </>
          ) : (
            <>
              Reading from a local pinagent dev-server (proxied through Vite). Start your host app
              with the pinagent plugin in another terminal, or append{' '}
              <code className="font-mono">?fixtures=on</code> to use the demo dataset.
            </>
          )}
        </p>
        <div className="mt-6 inline-flex items-start gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground max-w-prose">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-[10px] font-bold"
          >
            i
          </span>
          <span>
            <strong className="text-foreground">Opt-in:</strong> the dock does not auto-mount from{' '}
            <code className="font-mono">@pinagent/vite-plugin</code> or{' '}
            <code className="font-mono">@pinagent/next-plugin</code>. The per-element widget ships
            by default; project authors opt in to the dock explicitly. See the package README for
            details.
          </span>
        </div>
      </div>
    </div>
  );
}

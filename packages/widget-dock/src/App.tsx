// SPDX-License-Identifier: Apache-2.0
/**
 * Dev sample app. Renders the dock as it'll appear embedded on a host
 * page, with mock content behind the FAB. Phase 5 wires real fixtures
 * into the route views.
 *
 * `?state=disconnected` forces the disconnected indicator + state — a
 * cheap way to eyeball every variant without real network conditions.
 */
import { useMemo, useState } from 'react';
import { DockChrome } from './shell/DockChrome';
import { DockFAB } from './shell/DockFAB';
import { DockSurface } from './shell/DockSurface';
import { NavRail, type RouteKey } from './shell/NavRail';
import { useDockMode } from './shell/useDockMode';
import { ROUTE_VIEWS } from './routes';
import { PinMark } from '@pinagent/ui/components/pin-mark';

export function App() {
  const dock = useDockMode();
  const [activeRoute, setActiveRoute] = useState<RouteKey>('overview');
  const params = useMemo(
    () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    [],
  );
  const disconnected = params.get('state') === 'disconnected';

  const expandedNav = dock.mode !== 'panel';
  const ActiveView = ROUTE_VIEWS[activeRoute];

  // Demo only — Phase 5 will pull this from real fixtures, with the
  // count reflecting `readyToLand` + `awaitingClarification` items.
  const pendingCount = 3;

  return (
    <div className="min-h-svh bg-background text-foreground antialiased font-sans">
      <HostBackdrop />

      <DockFAB
        open={dock.open}
        count={pendingCount}
        onToggle={dock.toggle}
      />

      <DockSurface open={dock.open} mode={dock.mode} embedded>
        <DockChrome
          mode={dock.mode}
          onModeChange={dock.setMode}
          onClose={() => dock.setOpen(false)}
          disconnected={disconnected}
          context="pinagent-demo"
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
 * embedded in. Replaced when this is wired into a real Vite / Next
 * host.
 */
function HostBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden -z-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,#F5EFD0_0%,transparent_55%),radial-gradient(circle_at_80%_70%,#F5EFD0_0%,transparent_50%)]" />
      <div className="container mx-auto max-w-4xl px-8 pt-24">
        <div className="flex items-center gap-3 text-muted-foreground">
          <PinMark size="sm" tone="ink" />
          <span className="text-xs uppercase tracking-wider">Pinagent dock — dev preview</span>
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          Click the pin to open the dock.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground leading-relaxed">
          This page stands in for any host app the dock embeds into. The FAB sits bottom-left;
          the per-element picker (built into <code className="font-mono">@pinagent/widget</code>)
          would sit bottom-right. Append <code className="font-mono">?state=disconnected</code>
          {' '}to the URL to see the disconnected indicator.
        </p>
        <p className="mt-6 text-xs text-muted-foreground/80">
          Route screens land in Phase 5; today every nav item renders the same placeholder.
        </p>
      </div>
    </div>
  );
}

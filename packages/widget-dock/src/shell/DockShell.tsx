// SPDX-License-Identifier: Apache-2.0
/**
 * Shell layout — the chrome + FAB + nav around every dock route. Renders
 * the current route into `<Outlet />`. Sits at the root of the route
 * tree (see `../router.tsx`).
 *
 * Two render modes:
 *   - embedded: no host backdrop; the iframe sits on top of the real
 *     host page. Body is transparent / click-through via
 *     [data-pinagent-embedded='true'] in globals.css.
 *   - standalone: paints a host backdrop so the dev preview has
 *     something to look like it's embedded in.
 */
import { PinMark } from '@pinagent/ui/components/pin-mark';
import { Outlet, useLocation } from '@tanstack/react-router';
import { Suspense, useMemo } from 'react';
import { useBranches } from '../hooks/useBranches';
import { useChanges } from '../hooks/useChanges';
import { useConversations } from '../hooks/useConversations';
import { useProjectSubscription } from '../hooks/useProjectSubscription';
import { usePullRequests } from '../hooks/usePullRequests';
import type { DockTransport } from '../transport';
import { useTransport } from '../transport';
import { DockChrome } from './DockChrome';
import { useDockEnvironment } from './DockEnvironment';
import { DockSurface } from './DockSurface';
import { ExtensionLaunchProvider, ExtensionNudgeBanner } from './ExtensionLaunch';
import { NavRail, ROUTES } from './NavRail';
import { filterNavRoutes } from './nav-route-filter';
import { RouteFallback } from './RouteFallback';
import { useDockMode } from './useDockMode';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useOpenConversationBridge } from './useOpenConversationBridge';

export function DockShell() {
  const { embedded, forcedDisconnected } = useDockEnvironment();
  const transport = useTransport();
  const dock = useDockMode();

  // Open a single WS connection to the dev-server's project channel.
  // When `conversations_changed` fires, the hook invalidates the
  // conversations query — Overview, Conversations, and the FAB badge
  // refetch automatically. Skipped in mock mode (nothing to subscribe
  // to) and when the chrome is forced into disconnected demo mode.
  const subscriptionEnabled = transport.kind === 'local' && !forcedDisconnected;
  const subscription = useProjectSubscription({ enabled: subscriptionEnabled });

  // Drives the disconnected indicator below. Reads the same conversations
  // cache the Overview/Conversations views use, so it stays in sync
  // without an extra fetch.
  const conversations = useConversations();

  // Worktree-flow tabs (Branches, Changes, PRs) only make sense when
  // there's data in them — on MCP-runtime or inline-mode projects they
  // stay permanently empty and become misleading dead nav. Treat
  // pre-load (`undefined`) as "show by default" so the tabs don't
  // flash hidden during the initial fetch. The active route always
  // stays visible (handled inside `filterNavRoutes`).
  const branches = useBranches();
  const changes = useChanges();
  const pullRequests = usePullRequests();

  // Disconnected = forced (?state=disconnected), HTTP failed, or the WS
  // bridge is down. Either signal is enough to surface the indicator;
  // both being down (no host at all) shows it without flicker.
  const httpDown = transport.kind === 'local' && conversations.isError && !conversations.isLoading;
  const wsDown = subscriptionEnabled && subscription.status === 'closed';
  const disconnected = forcedDisconnected || httpDown || wsDown;

  // Cmd+Shift+P toggle (also from host page via postMessage), g c / g h
  // / g s nav chord, / focuses the active search input, and (when
  // embedded) c forwards to the host to open the widget picker.
  // Esc-to-close stays in useDockMode (panel mode only).
  useKeyboardShortcuts({
    onToggle: dock.toggle,
    open: () => dock.setOpen(true),
    isOpen: dock.open,
    embedded,
  });

  // The widget posts `open-conversation` from two places — the composer's
  // "open in dock" button and the agent tray's per-row "Open" — to jump the
  // dock to that conversation's detail.
  useOpenConversationBridge(() => dock.setOpen(true));

  const expandedNav = dock.mode !== 'panel';
  const context = transport.kind === 'mock' ? 'fixtures' : 'pinagent-demo';

  // Announce route changes to assistive tech. The visual `aria-current`
  // on the nav rail tells you what's selected; the live region tells
  // you you've arrived. `polite` because route changes are user-driven.
  const location = useLocation();
  const activeLabel = useMemo(
    () => ROUTES.find((r) => r.path === location.pathname)?.label ?? '',
    [location.pathname],
  );

  // Treat `undefined` (loading) as "non-empty" so the tab doesn't flash
  // hidden before the first fetch lands. `Number.POSITIVE_INFINITY`
  // makes the >0 check inside `filterNavRoutes` trivially true.
  const visibleRoutes = useMemo(
    () =>
      filterNavRoutes({
        routes: ROUTES,
        counts: {
          branches: branches.data?.length ?? Number.POSITIVE_INFINITY,
          changes: changes.data?.length ?? Number.POSITIVE_INFINITY,
          prs: pullRequests.data?.length ?? Number.POSITIVE_INFINITY,
        },
        activePath: location.pathname,
      }),
    [branches.data, changes.data, pullRequests.data, location.pathname],
  );

  const surface = (
    <ExtensionLaunchProvider>
      <DockSurface open={dock.open} mode={dock.mode} embedded>
        <DockChrome
          mode={dock.mode}
          onModeChange={dock.setMode}
          onClose={() => dock.setOpen(false)}
          disconnected={disconnected}
          context={context}
        />
        <ExtensionNudgeBanner />
        <div className="flex flex-1 min-h-0">
          <NavRail expanded={expandedNav} routes={visibleRoutes} />
          <main aria-label="Dock content" className="flex flex-1 flex-col overflow-auto">
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {activeLabel && `${activeLabel} view`}
        </div>
      </DockSurface>
    </ExtensionLaunchProvider>
  );

  if (embedded) return surface;

  return (
    <div className="min-h-svh bg-background text-foreground antialiased font-sans">
      <HostBackdrop transportKind={transport.kind} />
      {surface}
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
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Press ⌘⇧P to open the dock.</h1>
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

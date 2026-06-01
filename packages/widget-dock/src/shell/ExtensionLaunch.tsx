// SPDX-License-Identifier: Apache-2.0
/**
 * Just-in-time install nudge for the VSCode extension.
 *
 * Firing a `vscode://` deep link is fire-and-forget — the browser never
 * tells us whether it landed. Rather than guess with blur/timeout
 * heuristics, we lean on the reliable presence signal from the WS bridge
 * (`useExtensionStatus`): when the developer triggers an "open in VS
 * Code" action while the extension is known-absent, we still fire the
 * URI (best-effort) and surface a dismissible banner pointing at the
 * install card. If presence is unknown or the extension is connected, we
 * stay out of the way.
 */
import { Link } from '@tanstack/react-router';
import { ArrowRight, Puzzle, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useExtensionStatus } from '../hooks/useExtensionStatus';
import { ROUTE_PATHS } from '../route-paths';

interface ExtensionLaunchContextValue {
  /**
   * Run an "open in VS Code" action, then nudge the user to install the
   * extension if we know it isn't connected. Always runs `fire` — a
   * developer who has the extension on a port we can't reach still gets
   * the launch attempt.
   */
  attemptLaunch: (fire: () => void) => void;
  /** Whether the nudge banner is currently showing. */
  nudged: boolean;
  /** Hide the banner and suppress it for the rest of the session. */
  dismiss: () => void;
}

// Safe no-op default so leaf consumers (e.g. an AnchorChip rendered in
// isolation in tests) don't crash when no provider is mounted — they
// just launch without the nudge.
const ExtensionLaunchContext = createContext<ExtensionLaunchContextValue>({
  attemptLaunch: (fire) => fire(),
  nudged: false,
  dismiss: () => {},
});

export function ExtensionLaunchProvider({ children }: { children: ReactNode }) {
  const { present, known } = useExtensionStatus();
  const [nudged, setNudged] = useState(false);
  // Once dismissed, stay quiet until the dock reloads — re-nagging on
  // every click would be worse than the missing extension.
  const [dismissed, setDismissed] = useState(false);

  const attemptLaunch = useCallback(
    (fire: () => void) => {
      fire();
      if (known && !present && !dismissed) setNudged(true);
    },
    [known, present, dismissed],
  );

  const dismiss = useCallback(() => {
    setNudged(false);
    setDismissed(true);
  }, []);

  // Presence can flip to connected after the banner shows (the developer
  // installs mid-session); fold that in without waiting for another click.
  const value = useMemo<ExtensionLaunchContextValue>(
    () => ({ attemptLaunch, nudged: nudged && !present, dismiss }),
    [attemptLaunch, nudged, present, dismiss],
  );

  return (
    <ExtensionLaunchContext.Provider value={value}>{children}</ExtensionLaunchContext.Provider>
  );
}

export function useExtensionLaunch(): ExtensionLaunchContextValue {
  return useContext(ExtensionLaunchContext);
}

/**
 * The nudge banner. Renders only while `nudged`; mounts near the top of
 * the dock surface so it's visible regardless of the active route.
 */
export function ExtensionNudgeBanner() {
  const { nudged, dismiss } = useExtensionLaunch();
  if (!nudged) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-status-pending-border bg-status-pending-bg px-3 py-2 text-[11.5px] text-status-pending-fg"
    >
      <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="flex-1 leading-relaxed">
        <span className="font-medium">VS Code extension not detected.</span> Clicks may not open
        Claude Code or jump to files.{' '}
        <Link
          to={ROUTE_PATHS.connections}
          onClick={dismiss}
          className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2 hover:opacity-80"
        >
          Install it
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 rounded p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

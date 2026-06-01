// SPDX-License-Identifier: Apache-2.0
/**
 * Worktree preview — switch which worktree's running app shows in an
 * embedded iframe, without leaving the dock or juggling browser tabs.
 *
 * The dock itself stays connected to the main dev-server (the source of
 * truth for conversations/branches); this view only swaps the preview
 * iframe's `src` between the main app and each worktree's on-demand dev
 * server. Selecting a worktree that has no server yet starts one via
 * `serveBranch`; selecting "Main app" hides the iframe so the host page
 * (which the dock overlays) shows through.
 *
 * The active selection lives in the route's `?id` search param, so it is
 * deep-linkable (the Branches "Open in dock" action sets it) and survives
 * in-dock navigation. Live updates: a `worktree_servers_changed` project
 * event invalidates the server list, so starts/exits/stops from anywhere
 * (this dock, the Branches "Open app" button, a crash) reflect here.
 *
 * The iframe URL carries `?pinagent_dock=off` so the worktree app — which
 * runs the same pinagent plugin — doesn't stack a second dock inside the
 * preview (the plugins honor that flag; see vite-plugin DOCK_IFRAME_SCRIPT
 * and next-plugin component.tsx).
 */

import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AppWindow, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Branch } from '../fixtures/types';
import {
  useBranches,
  useServeBranch,
  useStopWorktreeServer,
  useWorktreeServers,
} from '../hooks/useBranches';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';

/** Append `?pinagent_dock=off` so the previewed app doesn't nest a dock. */
function suppressDock(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('pinagent_dock', 'off');
    return u.toString();
  } catch {
    // Defensive: a malformed URL shouldn't crash the view.
    return url.includes('?') ? `${url}&pinagent_dock=off` : `${url}?pinagent_dock=off`;
  }
}

// Persist the last-viewed worktree so it's restored after a full dock
// reload (embedded mode uses memory history, so the `?id` search param is
// lost on reload). All access is wrapped — localStorage can throw in
// locked-down/incognito contexts, and we'd rather degrade than crash.
const LAST_WORKTREE_KEY = 'pinagent.dock.preview.lastWorktree';

function readLastWorktree(): string | null {
  try {
    return window.localStorage.getItem(LAST_WORKTREE_KEY);
  } catch {
    return null;
  }
}

function writeLastWorktree(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(LAST_WORKTREE_KEY, id);
    else window.localStorage.removeItem(LAST_WORKTREE_KEY);
  } catch {
    // Persistence is best-effort.
  }
}

export function WorktreePreview() {
  const branchesQuery = useBranches();
  const serversQuery = useWorktreeServers();
  const serveMutation = useServeBranch();
  const stopMutation = useStopWorktreeServer();

  const { id: selectedId } = useSearch({ from: '/preview' });
  const navigate = useNavigate();
  // Bumped to force the iframe to remount on "reload" (changing `key`).
  const [reloadNonce, setReloadNonce] = useState(0);

  // Only worktrees linked to a conversation can be served (the serve
  // endpoint is keyed by conversation id). Inline-mode rows are skipped.
  const worktrees = useMemo(
    () =>
      (branchesQuery.data ?? []).filter(
        (b): b is Branch & { conversationId: string } => b.conversationId !== null,
      ),
    [branchesQuery.data],
  );

  const serverByConv = useMemo(() => {
    const map = new Map<string, { url: string; status: 'starting' | 'running' }>();
    for (const s of serversQuery.data ?? [])
      map.set(s.feedbackId, { url: s.url, status: s.status });
    return map;
  }, [serversQuery.data]);

  const select = (target: string | null): void => {
    // Persist on explicit selection (including "main" → clear) so we never
    // re-restore a worktree the user just dismissed.
    writeLastWorktree(target);
    void navigate({ to: '/preview', search: target ? { id: target } : {} });
  };

  // Restore the last-viewed worktree on a cold open (no `?id` yet), once
  // the worktree list has loaded so we can drop a stale (pruned) id. Runs
  // at most once; an explicit/deep-linked selection always wins.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (selectedId) {
      restoredRef.current = true;
      return;
    }
    if (worktrees.length === 0) return; // wait for the list
    restoredRef.current = true;
    const last = readLastWorktree();
    if (last && worktrees.some((w) => w.conversationId === last)) {
      void navigate({ to: '/preview', search: { id: last }, replace: true });
    }
  }, [selectedId, worktrees, navigate]);

  // Auto-start the selected worktree's server if it isn't running yet —
  // covers deep-links from the Branches "Open in dock" action. Guarded by
  // a ref so we attempt each id at most once (the mutation invalidates the
  // server list, which would otherwise re-trigger this effect).
  const attemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      attemptedRef.current = null;
      return;
    }
    if (serverByConv.has(selectedId)) return;
    if (attemptedRef.current === selectedId) return;
    if (!worktrees.some((w) => w.conversationId === selectedId)) return;
    attemptedRef.current = selectedId;
    serveMutation.mutate(selectedId);
  }, [selectedId, serverByConv, worktrees, serveMutation]);

  const handleStop = (id: string): void => {
    stopMutation.mutate(id, {
      // If we stopped the worktree we're viewing, fall back to the main app.
      onSuccess: () => {
        if (id === selectedId) select(null);
      },
    });
  };

  if (branchesQuery.isLoading) return <LoadingState rows={3} />;
  if (branchesQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load worktrees"
        description="The dock couldn't reach the local pinagent dev-server."
        onRetry={() => branchesQuery.refetch()}
      />
    );
  }
  if (worktrees.length === 0) {
    return (
      <EmptyState
        Icon={AppWindow}
        title="No worktrees to preview"
        description="When a conversation runs in worktree mode, you can start its app here and switch between worktrees without leaving the dock."
      />
    );
  }

  const startingId =
    serveMutation.isPending && typeof serveMutation.variables === 'string'
      ? serveMutation.variables
      : null;
  const activeServer = selectedId ? serverByConv.get(selectedId) : undefined;
  const iframeSrc = activeServer ? suppressDock(activeServer.url) : null;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Switcher */}
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-tight mr-1">Preview</h2>
        <SwitcherChip label="Main app" active={!selectedId} onClick={() => select(null)} />
        {worktrees.map((b) => {
          const server = serverByConv.get(b.conversationId);
          const isRunning = server?.status === 'running';
          return (
            <SwitcherChip
              key={b.conversationId}
              label={b.name}
              active={selectedId === b.conversationId}
              running={isRunning}
              starting={startingId === b.conversationId || server?.status === 'starting'}
              onClick={() => select(b.conversationId)}
              onStop={isRunning ? () => handleStop(b.conversationId) : undefined}
              stopPending={stopMutation.isPending && stopMutation.variables === b.conversationId}
            />
          );
        })}
        {iframeSrc && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Reload preview"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Open in a new tab"
              onClick={() => window.open(iframeSrc, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {serveMutation.isError && (
        <div className="border-b border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
          Couldn't start the dev server: {serveMutation.error.message}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0">
        {iframeSrc ? (
          <iframe
            key={`${iframeSrc}#${reloadNonce}`}
            src={iframeSrc}
            title="Worktree app preview"
            className="h-full w-full border-0 bg-background"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
              {selectedId ? (
                'Starting the dev server…'
              ) : (
                <>
                  Showing your <span className="text-foreground">main app</span>. Pick a worktree
                  above to start its dev server and preview its running app here.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SwitcherChip({
  label,
  active,
  running,
  starting,
  onClick,
  onStop,
  stopPending,
}: {
  label: string;
  active: boolean;
  running?: boolean;
  starting?: boolean;
  onClick: () => void;
  /** Present only for worktrees with a running server. */
  onStop?: () => void;
  stopPending?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border max-w-[220px]',
        active
          ? 'border-foreground/40 bg-secondary text-foreground'
          : 'border-border bg-card text-muted-foreground',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={starting}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
          'transition-colors disabled:opacity-60 disabled:cursor-wait',
          !active && 'hover:text-foreground',
        )}
      >
        {running && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-landed-fg"
            title="Server running"
          />
        )}
        <span className="truncate font-mono">{starting ? 'Starting…' : label}</span>
      </button>
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopPending}
          title="Stop this worktree's dev server"
          aria-label={`Stop ${label} dev server`}
          className="inline-flex items-center pr-2 pl-0.5 text-muted-foreground hover:text-status-error-fg disabled:opacity-60"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

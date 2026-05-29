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
 * The iframe URL carries `?pinagent_dock=off` so the worktree app — which
 * runs the same pinagent plugin — doesn't stack a second dock inside the
 * preview (the plugins honor that flag; see vite-plugin DOCK_IFRAME_SCRIPT
 * and next-plugin component.tsx).
 */

import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { AppWindow, ExternalLink, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Branch } from '../fixtures/types';
import { useBranches, useServeBranch, useWorktreeServers } from '../hooks/useBranches';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';

/** `'main'` shows the host app (iframe hidden); otherwise a worktree id. */
type Selection = 'main' | string;

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

export function WorktreePreview() {
  const branchesQuery = useBranches();
  const serversQuery = useWorktreeServers();
  const serveMutation = useServeBranch();

  const [active, setActive] = useState<Selection>('main');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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

  const select = (target: Selection): void => {
    if (target === 'main') {
      setActive('main');
      setPreviewUrl(null);
      return;
    }
    const running = serverByConv.get(target);
    if (running) {
      setActive(target);
      setPreviewUrl(running.url);
      return;
    }
    // No server yet — start one, then point the iframe at it.
    serveMutation.mutate(target, {
      onSuccess: (result) => {
        setActive(target);
        setPreviewUrl(result.url);
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
  const iframeSrc = previewUrl ? suppressDock(previewUrl) : null;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Switcher */}
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-tight mr-1">Preview</h2>
        <SwitcherButton
          label="Main app"
          active={active === 'main'}
          onClick={() => select('main')}
        />
        {worktrees.map((b) => {
          const server = serverByConv.get(b.conversationId);
          return (
            <SwitcherButton
              key={b.conversationId}
              label={b.name}
              active={active === b.conversationId}
              running={server?.status === 'running'}
              starting={startingId === b.conversationId || server?.status === 'starting'}
              onClick={() => select(b.conversationId)}
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
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
              Showing your <span className="text-foreground">main app</span>. Pick a worktree above
              to start its dev server and preview its running app here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SwitcherButton({
  label,
  active,
  running,
  starting,
  onClick,
}: {
  label: string;
  active: boolean;
  running?: boolean;
  starting?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={starting}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium max-w-[200px]',
        'transition-colors disabled:opacity-60 disabled:cursor-wait',
        active
          ? 'border-foreground/40 bg-secondary text-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60',
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
  );
}

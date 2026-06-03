// SPDX-License-Identifier: Apache-2.0
/**
 * PRs — read-only view of pull requests originating from pinagent.
 * Reads from `GET /__pinagent/prs`, which serves rows the PR composer
 * wrote on its success path. No GitHub round-trip on read; `state`
 * reflects what the composer knew at insert time and may lag the
 * upstream PR.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ExternalLink, GitPullRequest, Plus, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TimestampDot } from '../components/TimestampDot';
import type { PullRequest } from '../fixtures';
import { usePullRequests, useRefreshPullRequests } from '../hooks/usePullRequests';
import { ROUTE_PATHS } from '../route-paths';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';

const STATE_TONE: Record<PullRequest['state'], string> = {
  open: 'text-status-working-fg border-status-working-border bg-status-working-bg',
  draft: 'text-muted-foreground border-border bg-secondary/60',
  merged: 'text-status-landed-fg border-status-landed-border bg-status-landed-bg',
  closed: 'text-status-discarded-fg border-status-discarded-border bg-status-discarded-bg',
};

const STATE_LABEL: Record<PullRequest['state'], string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

export function PRs() {
  const transport = useTransport();
  const prsQuery = usePullRequests();
  const refresh = useRefreshPullRequests();
  const navigate = useNavigate();
  const isMock = transport.kind === 'mock';

  // Reconcile against GitHub once when the tab opens so a PR that was
  // closed/merged upstream doesn't linger as "open". Background: the cached
  // list renders immediately; the mutation patches it on success.
  const didAutoRefresh = useRef(false);
  useEffect(() => {
    if (isMock || didAutoRefresh.current) return;
    didAutoRefresh.current = true;
    refresh.mutate();
  }, [isMock, refresh]);

  // Deep-link target from the activity feed (`?number=<pr>`): scroll that
  // row into view and flash a highlight ring that fades on a timer. Keyed
  // on the loaded data so it re-runs once the row's ref is registered.
  const { number: focusNumber } = useSearch({ from: ROUTE_PATHS.prs });
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const [highlighted, setHighlighted] = useState<number | null>(null);
  useEffect(() => {
    // `prsQuery.data` gates on the rows being rendered (so their refs are
    // registered) and re-runs the scroll once they load.
    if (focusNumber == null || !prsQuery.data) return;
    const el = rowRefs.current.get(focusNumber);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlighted(focusNumber);
    const t = setTimeout(() => setHighlighted((n) => (n === focusNumber ? null : n)), 2200);
    return () => clearTimeout(t);
  }, [focusNumber, prsQuery.data]);
  const registerRow = (n: number, el: HTMLElement | null): void => {
    if (el) rowRefs.current.set(n, el);
    else rowRefs.current.delete(n);
  };

  const newPr = () => void navigate({ to: ROUTE_PATHS.prsNew });

  if (prsQuery.isLoading) return <LoadingState rows={4} />;

  if (prsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load PRs"
        description={
          <>
            The dock couldn't reach the local pinagent dev-server. Make sure your host app is
            running with the pinagent plugin, or append{' '}
            <code className="font-mono">?fixtures=on</code> to use the demo dataset.
          </>
        }
        onRetry={() => prsQuery.refetch()}
      />
    );
  }

  const prs = prsQuery.data ?? [];

  if (prs.length === 0) {
    return (
      <EmptyState
        Icon={GitPullRequest}
        title="No PRs yet"
        description={
          isMock
            ? '(Mock mode — switch off ?fixtures=on for real data.)'
            : 'Bundle a few resolved conversations into a PR — they’ll appear here once opened.'
        }
        action={
          <Button size="sm" variant="accent" className="h-7 gap-1.5 text-xs" onClick={newPr}>
            <Plus className="h-3 w-3" />
            New PR
          </Button>
        }
      />
    );
  }

  const openCount = prs.filter((p) => p.state === 'open' || p.state === 'draft').length;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Pull requests</h2>
        <span className="text-[11px] text-muted-foreground">
          {openCount} open · {prs.length} total
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || isMock}
            title={
              isMock
                ? 'Refresh reconciles against GitHub — unavailable in fixtures mode'
                : 'Reconcile PR state against GitHub'
            }
          >
            <RotateCw className={cn('h-3 w-3', refresh.isPending && 'animate-spin')} />
            {refresh.isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={newPr}>
            <Plus className="h-3 w-3" />
            New PR
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-1.5">
        {prs.map((pr) => (
          <PRRow
            key={pr.id}
            pr={pr}
            highlighted={highlighted === pr.number}
            registerRef={registerRow}
          />
        ))}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {isMock
            ? 'Fixtures · switch off ?fixtures=on for live PR data.'
            : 'Read-only · state may lag GitHub. Use “New PR” to compose another.'}
        </p>
      </div>
    </div>
  );
}

function PRRow({
  pr,
  highlighted,
  registerRef,
}: {
  pr: PullRequest;
  highlighted: boolean;
  registerRef: (n: number, el: HTMLElement | null) => void;
}) {
  const conversationLabel =
    pr.conversationIds.length === 0
      ? null
      : pr.conversationIds.length === 1
        ? '1 conversation'
        : `${pr.conversationIds.length} conversations`;

  return (
    <article
      ref={(el) => registerRef(pr.number, el)}
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5',
        'transition-shadow duration-700',
        highlighted ? 'border-accent/60 ring-2 ring-accent/60' : 'border-border ring-0',
      )}
    >
      <GitPullRequest aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
            <span className="text-muted-foreground tabular-nums">#{pr.number}</span> {pr.title}
          </span>
          <TimestampDot iso={pr.updatedAt} className="mt-0.5" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
              STATE_TONE[pr.state],
            )}
          >
            {STATE_LABEL[pr.state]}
          </span>
          <span className="font-mono text-[10.5px] truncate">
            {pr.branch}
            <span className="text-muted-foreground/60"> → {pr.baseBranch}</span>
          </span>
          {conversationLabel && (
            <Badge variant="outline" className="text-[10px]">
              {conversationLabel}
            </Badge>
          )}
        </div>
      </div>
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Open on GitHub"
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs',
          'text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        )}
      >
        <ExternalLink className="h-3 w-3" />
        GitHub
      </a>
    </article>
  );
}

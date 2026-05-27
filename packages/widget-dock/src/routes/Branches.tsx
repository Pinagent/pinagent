// SPDX-License-Identifier: Apache-2.0
/**
 * Branches — live view of worktrees with prune actions. Reads from
 * `GET /__pinagent/branches`; per-row prune issues `DELETE /__pinagent/branches/:id`;
 * the header's "Prune stale" button issues `POST /__pinagent/branches/prune-stale`,
 * which uses the server's `worktreeRetentionDays` setting as the cutoff.
 *
 * Stale threshold mirrors the server: read `worktreeRetentionDays` from
 * `useSettings` and fall back to 7 days while the read is in flight or
 * fails. Keeps "X stale" in the header matching what the bulk prune
 * actually targets.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { AlertTriangle, GitBranch, MessageSquare, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TimestampDot } from '../components/TimestampDot';
import type { Branch } from '../fixtures/types';
import { useBranches, usePruneBranch, usePruneStaleBranches } from '../hooks/useBranches';
import { useSettings } from '../hooks/useSettings';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { type PruneStaleResult, useTransport } from '../transport';

const STATE_LABEL: Record<Branch['state'], string> = {
  clean: 'Clean',
  uncommitted: 'Uncommitted',
  'behind-base': 'Behind base',
};

const STATE_TONE: Record<Branch['state'], string> = {
  clean: 'text-status-landed-fg border-status-landed-border bg-status-landed-bg',
  uncommitted: 'text-status-working-fg border-status-working-border bg-status-working-bg',
  'behind-base': 'text-status-awaiting-fg border-status-awaiting-border bg-status-awaiting-bg',
};

const DEFAULT_RETENTION_DAYS = 7;

function isStale(lastActivity: string, now: number, retentionDays: number): boolean {
  return now - Date.parse(lastActivity) > retentionDays * 24 * 60 * 60 * 1000;
}

export function Branches() {
  const transport = useTransport();
  const branchesQuery = useBranches();
  const settingsQuery = useSettings();
  const pruneStaleMutation = usePruneStaleBranches();
  const [staleResult, setStaleResult] = useState<PruneStaleResult | null>(null);
  const isMock = transport.kind === 'mock';

  // Read-time, not load-time — the 7-day cutoff makes "now drifts by a
  // few ms between two row renders" inconsequential.
  const now = Date.now();
  const retentionDays = settingsQuery.data?.worktreeRetentionDays ?? DEFAULT_RETENTION_DAYS;

  if (branchesQuery.isLoading) return <LoadingState rows={4} />;

  if (branchesQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load branches"
        description={
          <>
            The dock couldn't reach the local pinagent dev-server. Make sure your host app is
            running with the pinagent plugin, or append{' '}
            <code className="font-mono">?fixtures=on</code> to use the demo dataset.
          </>
        }
        onRetry={() => branchesQuery.refetch()}
      />
    );
  }

  const branches = branchesQuery.data ?? [];

  if (branches.length === 0) {
    return (
      <EmptyState
        Icon={GitBranch}
        title="No worktrees yet"
        description={
          isMock
            ? '(Mock mode — switch off ?fixtures=on for real data.)'
            : "When a conversation starts in worktree mode, the agent spins up a fresh worktree off your base branch. You'll see it here."
        }
      />
    );
  }

  const totalDiskMb = branches.reduce((sum, b) => sum + (b.diskMb ?? 0), 0);
  const stale = branches.filter((b) => isStale(b.lastActivity, now, retentionDays));

  const handlePruneStale = async (): Promise<void> => {
    setStaleResult(null);
    try {
      const result = await pruneStaleMutation.mutateAsync();
      setStaleResult(result);
    } catch {
      // Mutation error already surfaces via `pruneStaleMutation.error`.
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Branches</h2>
        <span className="text-[11px] text-muted-foreground">
          {branches.length} active{totalDiskMb > 0 ? ` · ${totalDiskMb} MB on disk` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {stale.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={handlePruneStale}
              disabled={pruneStaleMutation.isPending}
              title={`Older than ${retentionDays} days`}
            >
              <Trash2 className="h-3 w-3" />
              {pruneStaleMutation.isPending ? 'Pruning…' : `Prune stale (${stale.length})`}
            </Button>
          )}
        </div>
      </div>

      {(staleResult || pruneStaleMutation.isError) && (
        <PruneStaleBanner
          result={staleResult}
          error={pruneStaleMutation.error?.message ?? null}
          onDismiss={() => {
            setStaleResult(null);
            pruneStaleMutation.reset();
          }}
        />
      )}

      <div className="flex-1 overflow-auto p-3 space-y-1.5">
        {branches.map((b) => (
          <BranchRow
            key={b.id}
            branch={b}
            stale={isStale(b.lastActivity, now, retentionDays)}
            isMock={isMock}
          />
        ))}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {isMock
            ? 'Fixtures · switch off ?fixtures=on for live worktree data.'
            : `Prune tears down the worktree + local branch. Stale = older than ${retentionDays} days (Settings → Worktree retention).`}
        </p>
      </div>
    </div>
  );
}

function PruneStaleBanner({
  result,
  error,
  onDismiss,
}: {
  result: PruneStaleResult | null;
  error: string | null;
  onDismiss: () => void;
}) {
  if (error) {
    return (
      <div className="border-b border-status-error-border bg-status-error-bg px-3 py-2 flex items-start gap-2 text-[12px] text-status-error-fg">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 leading-snug">Bulk prune failed: {error}</span>
        <button
          type="button"
          className="text-[11px] underline hover:opacity-80"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (!result) return null;
  const okCount = result.pruned.length;
  const failCount = result.failed.length;
  return (
    <div
      className={cn(
        'border-b px-3 py-2 flex items-start gap-2 text-[12px]',
        failCount === 0
          ? 'border-status-landed-border bg-status-landed-bg text-status-landed-fg'
          : 'border-status-awaiting-border bg-status-awaiting-bg text-status-awaiting-fg',
      )}
    >
      <span className="flex-1 leading-snug">
        Pruned {okCount} worktree{okCount === 1 ? '' : 's'} older than {result.retentionDays} days
        {failCount > 0 && ` · ${failCount} failed`}
        {failCount > 0 && '.'}
      </span>
      <button type="button" className="text-[11px] underline hover:opacity-80" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function BranchRow({ branch, stale, isMock }: { branch: Branch; stale: boolean; isMock: boolean }) {
  const pruneMutation = usePruneBranch();
  const disabled = isMock || !branch.conversationId || pruneMutation.isPending;
  const handlePrune = (): void => {
    if (!branch.conversationId) return;
    pruneMutation.mutate(branch.conversationId);
  };

  return (
    <article
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5',
        stale && 'border-dashed',
      )}
    >
      <GitBranch aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className="flex-1 truncate font-mono text-[12.5px] text-foreground">
            {branch.name}
          </span>
          <TimestampDot iso={branch.lastActivity} className="mt-0.5" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
              STATE_TONE[branch.state],
            )}
          >
            {STATE_LABEL[branch.state]}
          </span>
          {branch.conversationTitle ? (
            <span className="inline-flex items-center gap-1 truncate">
              <MessageSquare className="h-3 w-3 shrink-0" />
              <span className="truncate">{branch.conversationTitle}</span>
            </span>
          ) : (
            <span className="italic">No conversation linked</span>
          )}
          {branch.diskMb !== null && <span className="tabular-nums">{branch.diskMb} MB</span>}
          {stale && (
            <Badge variant="outline" className="text-[10px]">
              stale
            </Badge>
          )}
          {pruneMutation.isError && (
            <span className="text-[10px] text-status-error-fg" title={pruneMutation.error.message}>
              · prune failed
            </span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={handlePrune}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-status-error-fg"
        title={
          isMock
            ? 'Mock mode — fake prune'
            : pruneMutation.isPending
              ? 'Pruning…'
              : 'Prune worktree'
        }
      >
        {pruneMutation.isPending ? '…' : <Trash2 className="h-3 w-3" />}
      </Button>
    </article>
  );
}

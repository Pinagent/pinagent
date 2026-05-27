// SPDX-License-Identifier: Apache-2.0
/**
 * Branches — read-only view of active worktrees and their git state.
 * Reads from `GET /__pinagent/branches` (server-side: walks Storage
 * for conversations with worktreePath set, runs `git status` + `du`
 * for each).
 *
 * Discard surfaces the same `discard_request` WS call the Conversations
 * detail view uses — that's the existing path for "tear down this
 * worktree." We use the same verb everywhere instead of inventing a
 * separate "prune" for the same action.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { GitBranch, MessageSquare, Trash2 } from 'lucide-react';
import { TimestampDot } from '../components/TimestampDot';
import type { Branch } from '../fixtures/types';
import { useBranches } from '../hooks/useBranches';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';

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

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function isStale(lastActivity: string, now: number): boolean {
  return now - Date.parse(lastActivity) > STALE_THRESHOLD_MS;
}

export function Branches() {
  const transport = useTransport();
  const branchesQuery = useBranches();
  const isMock = transport.kind === 'mock';

  // Computed at render time — `isStale` is a single subtraction so the
  // per-render cost is nothing, and the 7-day threshold makes "now drifts
  // by a few ms between two row renders" inconsequential.
  const now = Date.now();

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
  const staleCount = branches.filter((b) => isStale(b.lastActivity, now)).length;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Branches</h2>
        <span className="text-[11px] text-muted-foreground">
          {branches.length} active{totalDiskMb > 0 ? ` · ${totalDiskMb} MB on disk` : ''}
        </span>
        {staleCount > 0 && (
          <span className="ml-auto text-[11px] text-status-anchor-lost-fg tabular-nums">
            {staleCount} stale
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-1.5">
        {branches.map((b) => (
          <BranchRow
            key={b.id}
            branch={b}
            stale={isStale(b.lastActivity, now)}
            onDiscard={
              b.conversationId ? () => transport.discardConversation(b.conversationId!) : undefined
            }
            disableDiscard={isMock || !b.conversationId}
          />
        ))}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {isMock
            ? 'Fixtures · switch off ?fixtures=on for live worktree data.'
            : 'Discard tears down the worktree and the local branch. The conversation row stays for history.'}
        </p>
      </div>
    </div>
  );
}

function BranchRow({
  branch,
  stale,
  onDiscard,
  disableDiscard,
}: {
  branch: Branch;
  stale: boolean;
  onDiscard?: () => void;
  disableDiscard: boolean;
}) {
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
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={disableDiscard}
        onClick={onDiscard}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-status-error-fg"
        title={disableDiscard ? 'Mock mode — no real action' : 'Discard worktree'}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </article>
  );
}

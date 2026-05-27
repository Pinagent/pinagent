// SPDX-License-Identifier: Apache-2.0
/**
 * Branches — read-only view of active worktrees and their git state.
 * Backed by fixtures for Phase 1; the Prune actions land with Phase 4
 * (worktree management), so they render disabled here with an inline
 * note pointing at the eventual capability.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { GitBranch, MessageSquare, Trash2 } from 'lucide-react';
import { TimestampDot } from '../components/TimestampDot';
import { type Branch, FIXTURE_BRANCHES } from '../fixtures';
import { EmptyState } from '../shell/states';

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
const FIXTURE_NOW = Date.parse('2026-05-26T22:30:00Z');

function isStale(lastActivity: string): boolean {
  return FIXTURE_NOW - Date.parse(lastActivity) > STALE_THRESHOLD_MS;
}

// Module-level: fixture data is constant, no need to recompute per render.
const TOTAL_DISK_MB = FIXTURE_BRANCHES.reduce((sum, b) => sum + (b.diskMb ?? 0), 0);
const STALE_COUNT = FIXTURE_BRANCHES.filter((b) => isStale(b.lastActivity)).length;

export function Branches() {
  const branches = FIXTURE_BRANCHES;

  if (branches.length === 0) {
    return (
      <EmptyState
        Icon={GitBranch}
        title="No worktrees yet"
        description="When a conversation starts, the agent spins up a worktree off your base branch. You'll see it here."
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Branches</h2>
        <span className="text-[11px] text-muted-foreground">
          {branches.length} active · {TOTAL_DISK_MB} MB on disk
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled
            className="h-7 gap-1.5 text-xs"
            title="Prune actions land in Phase 4"
          >
            <Trash2 className="h-3 w-3" />
            Prune stale ({STALE_COUNT})
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-1.5">
        {branches.map((b) => (
          <BranchRow key={b.id} branch={b} stale={isStale(b.lastActivity)} />
        ))}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Read-only · prune + discard ship with Phase 4 (worktree management).
        </p>
      </div>
    </div>
  );
}

function BranchRow({ branch, stale }: { branch: Branch; stale: boolean }) {
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
        disabled
        className="h-7 px-2 text-xs text-muted-foreground"
        title="Prune lands in Phase 4"
      >
        Prune
      </Button>
    </article>
  );
}

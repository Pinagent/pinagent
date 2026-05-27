// SPDX-License-Identifier: Apache-2.0
/**
 * PRs — read-only view of pull requests originating from pinagent.
 * Phase 1 lists PRs with state badges and links out to GitHub. Phase 3
 * adds /prs/new (the composer); the New PR button is shown disabled to
 * preview that capability.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { ExternalLink, GitPullRequest, Plus } from 'lucide-react';
import { TimestampDot } from '../components/TimestampDot';
import { FIXTURE_PRS, type PullRequest } from '../fixtures';
import { EmptyState } from '../shell/states';

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
  const prs = FIXTURE_PRS;
  const openCount = prs.filter((p) => p.state === 'open' || p.state === 'draft').length;

  if (prs.length === 0) {
    return (
      <EmptyState
        Icon={GitPullRequest}
        title="No PRs yet"
        description="Once you batch a few resolved conversations into a PR from the Changes view, they'll appear here."
      />
    );
  }

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
            variant="outline"
            disabled
            className="h-7 gap-1.5 text-xs"
            title="PR composer ships with Phase 3"
          >
            <Plus className="h-3 w-3" />
            New PR
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-1.5">
        {prs.map((pr) => (
          <PRRow key={pr.id} pr={pr} />
        ))}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Read-only · the PR composer (batch conversations → one PR) ships with Phase 3.
        </p>
      </div>
    </div>
  );
}

function PRRow({ pr }: { pr: PullRequest }) {
  const conversationLabel =
    pr.conversationIds.length === 0
      ? null
      : pr.conversationIds.length === 1
        ? '1 conversation'
        : `${pr.conversationIds.length} conversations`;

  return (
    <article className="group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
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

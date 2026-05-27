// SPDX-License-Identifier: Apache-2.0

import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import {
  CheckCheck,
  GitMerge,
  GitPullRequest,
  MessageSquarePlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { ComponentType, ReactNode, SVGAttributes } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import { TimestampDot } from '../components/TimestampDot';
import {
  type ActivityEvent,
  CURRENT_PAGE,
  FIXTURE_ACTIVITY,
  FIXTURE_CONVERSATIONS,
} from '../fixtures';

const EVENT_ICON: Record<ActivityEvent['type'], ComponentType<SVGAttributes<SVGSVGElement>>> = {
  conversation_created: MessageSquarePlus,
  conversation_updated: Pencil,
  conversation_landed: CheckCheck,
  pr_created: GitPullRequest,
  pr_merged: GitMerge,
  worktree_pruned: Trash2,
};

function eventDescription(event: ActivityEvent): ReactNode {
  switch (event.type) {
    case 'conversation_created':
      return (
        <>
          New conversation · <span className="text-foreground">{event.conversationTitle}</span>
        </>
      );
    case 'conversation_updated':
      return (
        <>
          Update on <span className="text-foreground">{event.conversationTitle}</span>
        </>
      );
    case 'conversation_landed':
      return (
        <>
          Landed <span className="text-foreground">{event.conversationTitle}</span>
        </>
      );
    case 'pr_created':
      return (
        <>
          Opened PR <span className="text-foreground">#{event.prNumber}</span> from{' '}
          <span className="font-mono text-[11px]">{event.branch}</span>
        </>
      );
    case 'pr_merged':
      return (
        <>
          Merged PR <span className="text-foreground">#{event.prNumber}</span>
        </>
      );
    case 'worktree_pruned':
      return (
        <>
          Pruned worktree <span className="font-mono text-[11px]">{event.branch}</span>
        </>
      );
  }
}

function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 px-3 pt-4 pb-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {hint && <span className="text-[11px] text-muted-foreground/70 font-mono">{hint}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function Overview() {
  const onThisPage = FIXTURE_CONVERSATIONS.filter((c) => c.page === CURRENT_PAGE);
  const recent = FIXTURE_CONVERSATIONS.slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 8);

  return (
    <div className="flex flex-1 flex-col">
      <SectionHeader
        title="On this page"
        hint={CURRENT_PAGE}
        action={
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            View all
          </Button>
        }
      />
      {onThisPage.length > 0 ? (
        <div className="flex flex-col gap-1.5 px-3">
          {onThisPage.map((c) => (
            <ListRow
              key={c.id}
              status={c.status}
              title={c.title}
              meta={
                <>
                  <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />
                  <span className="truncate">{c.lastMessage}</span>
                </>
              }
              updatedAt={c.updatedAt}
            />
          ))}
        </div>
      ) : (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No conversations anchored to this page yet.
        </p>
      )}

      <SectionHeader title="Recent activity" />
      <ul className="flex flex-col gap-0.5 px-3 pb-4">
        {FIXTURE_ACTIVITY.slice(0, 7).map((event) => {
          const Icon = EVENT_ICON[event.type];
          return (
            <li
              key={event.id}
              className={cn(
                'flex items-start gap-2.5 rounded-md px-2 py-1.5',
                'hover:bg-secondary/40 transition-colors',
              )}
            >
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
              >
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
                {eventDescription(event)}
              </div>
              <TimestampDot iso={event.at} />
            </li>
          );
        })}
      </ul>

      <div className="mt-auto border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Visual demo · {recent.length} conversations loaded from fixtures. Phase 5 of the redesign
          — real transport lands later.
        </p>
      </div>
    </div>
  );
}

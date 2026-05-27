// SPDX-License-Identifier: Apache-2.0

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
import { type ActivityEvent, FIXTURE_ACTIVITY } from '../fixtures';
import { useConversations } from '../hooks/useConversations';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';

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
  const transport = useTransport();
  const conversations = useConversations();
  const isMock = transport.kind === 'mock';

  return (
    <div className="flex flex-1 flex-col">
      <SectionHeader title="Recent conversations" hint={isMock ? 'fixtures' : undefined} />

      {conversations.isLoading && <LoadingState rows={4} />}

      {conversations.isError && (
        <ErrorState
          title="Couldn't load conversations"
          description={
            <>
              The dock couldn't reach the local pinagent dev-server. Make sure your host app is
              running with the pinagent plugin, or append{' '}
              <code className="font-mono">?fixtures=on</code> to the URL to use the demo dataset.
            </>
          }
          onRetry={() => conversations.refetch()}
        />
      )}

      {conversations.isSuccess && conversations.data.length === 0 && (
        <EmptyState
          title="No conversations yet"
          description={
            <>
              Click any element on your host app with the pinagent picker to start a conversation.
              It'll show up here in real time.
            </>
          }
        />
      )}

      {conversations.isSuccess && conversations.data.length > 0 && (
        <div className="flex flex-col gap-1.5 px-3">
          {conversations.data.slice(0, 8).map((c) => (
            <ListRow
              key={c.id}
              status={c.status}
              title={c.title}
              meta={
                <>
                  {c.anchor.loc && <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />}
                  {c.page && (
                    <span className="truncate font-mono text-[10.5px]">
                      {new URL(c.page).pathname}
                    </span>
                  )}
                </>
              }
              updatedAt={c.updatedAt}
            />
          ))}
        </div>
      )}

      <SectionHeader title="Recent activity" hint="fixtures" />
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
          {isMock
            ? 'Fixtures · drop ?fixtures=on to read from a local pinagent dev-server.'
            : 'Live · activity feed still fixture-driven (PR-B adds the project subscription).'}
        </p>
      </div>
    </div>
  );
}

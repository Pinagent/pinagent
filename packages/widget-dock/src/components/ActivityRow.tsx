// SPDX-License-Identifier: Apache-2.0
/**
 * One row in the audit-log feed. Shared between the History route's
 * Activity tab (full feed, limit 200) and the Overview route's recent
 * activity strip (top 7). Keeping both consumers on the same component
 * means new audit `action` types only need to grow `describeEvent` once.
 */

import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { Link } from '@tanstack/react-router';
import {
  Bot,
  CheckCircle2,
  GitPullRequest,
  History as HistoryIcon,
  MessageSquarePlus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { AuditEvent } from '../transport';
import { TimestampDot } from './TimestampDot';

interface ActivityVisual {
  Icon: typeof HistoryIcon;
  status: StatusKey;
  label: string;
}

export function describeEvent(event: AuditEvent): ActivityVisual {
  switch (event.action) {
    case 'conversation_created':
      return { Icon: MessageSquarePlus, status: 'pending', label: 'Conversation opened' };
    case 'conversation_landed': {
      const via = (event.payload.via as string | undefined) === 'pr' ? ' via PR' : '';
      const target = event.payload.target as string | undefined;
      return {
        Icon: CheckCircle2,
        status: 'landed',
        label: `Landed${via}${target ? ` onto ${target}` : ''}`,
      };
    }
    case 'conversation_discarded':
      return { Icon: XCircle, status: 'discarded', label: 'Discarded' };
    case 'conversation_reopened':
      return { Icon: RotateCcw, status: 'pending', label: 'Reopened' };
    case 'conversation_resolved_by_agent': {
      const status = event.payload.status as string | undefined;
      const label =
        status === 'fixed'
          ? 'Agent marked fixed'
          : status === 'wontfix'
            ? "Agent marked won't fix"
            : status === 'deferred'
              ? 'Agent deferred'
              : 'Agent resolved';
      // Match the dock-status that the inline auto-promotion lands the
      // row in, so the dot color stays consistent with the conversation.
      const dotStatus: StatusKey =
        status === 'fixed'
          ? 'landed'
          : status === 'wontfix'
            ? 'discarded'
            : 'awaitingClarification';
      return { Icon: Bot, status: dotStatus, label };
    }
    case 'pr_created': {
      const number = event.payload.number as number | undefined;
      const title = event.payload.title as string | undefined;
      return {
        Icon: GitPullRequest,
        status: 'landed',
        label: number ? `PR #${number}${title ? ` — ${title}` : ''}` : 'Pull request opened',
      };
    }
    default:
      return { Icon: HistoryIcon, status: 'pending', label: event.action.replace(/_/g, ' ') };
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function activityMeta(event: AuditEvent): ReactNode | null {
  const parts: ReactNode[] = [];
  const branch = event.payload.branch as string | undefined;
  const file = event.payload.file as string | undefined;
  const page = event.payload.page as string | undefined;
  const commitSha = event.payload.commitSha as string | undefined;
  const url = event.payload.url as string | undefined;
  if (commitSha) {
    parts.push(
      <span key="sha" className="font-mono text-[10.5px]">
        {commitSha.slice(0, 12)}
      </span>,
    );
  }
  if (branch) {
    parts.push(
      <span key="branch" className="truncate font-mono text-[10.5px]">
        {branch}
      </span>,
    );
  }
  if (file) {
    parts.push(
      <span key="file" className="truncate font-mono text-[10.5px]">
        {file}
      </span>,
    );
  }
  if (page) {
    parts.push(
      <span key="page" className="truncate font-mono text-[10.5px]">
        {safePath(page)}
      </span>,
    );
  }
  if (url && event.action === 'pr_created') {
    parts.push(
      <a
        key="prurl"
        href={url}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        open on GitHub
      </a>,
    );
  }
  if (event.conversationId && event.action !== 'pr_created') {
    parts.push(
      <Badge key="cid" variant="outline" className="text-[10px]">
        {event.conversationId.slice(0, 8)}
      </Badge>,
    );
  }
  if (parts.length === 0) return null;
  return parts;
}

export function ActivityRow({ event }: { event: AuditEvent }) {
  const visual = describeEvent(event);
  const meta = activityMeta(event);
  const Icon = visual.Icon;
  const body = (
    <>
      <StatusBadge status={visual.status} variant="dot" className="mt-1.5 pointer-events-none" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <span className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
            {visual.label}
          </span>
          <TimestampDot iso={event.createdAt} className="mt-0.5" />
        </div>
        {meta && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
    </>
  );

  // Conversation-scoped events (`conversation_*`, plus any future
  // action that names a conversation) deep-link to the matching detail
  // view via `?id=`. Project-scoped events (`pr_created`,
  // `worktrees_bulk_pruned`) keep the static <li> render — their
  // payload already carries its own external link (PR URL) inside
  // `meta`, and nested anchors would be invalid markup.
  if (event.conversationId !== null) {
    return (
      <li>
        <Link
          to="/conversations"
          search={{ id: event.conversationId }}
          aria-label={`${visual.label} — open conversation`}
          className={cn(
            'group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2',
            'transition-colors hover:bg-secondary/40',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          )}
        >
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li className="group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2">
      {body}
    </li>
  );
}

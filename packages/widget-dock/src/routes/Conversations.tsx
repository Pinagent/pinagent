// SPDX-License-Identifier: Apache-2.0

import type { AgentEvent } from '@pinagent/shared';
import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { ArrowLeft, Filter, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import { TimestampDot } from '../components/TimestampDot';
import { useConversation } from '../hooks/useConversation';
import {
  type ConversationStream,
  type StreamItem,
  useConversationStream,
} from '../hooks/useConversationStream';
import { useConversations } from '../hooks/useConversations';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { type ConversationDetail, useTransport, type WorktreeStatePayload } from '../transport';

const STATUS_FILTERS: { label: string; status: StatusKey | 'all' }[] = [
  { label: 'All', status: 'all' },
  { label: 'Working', status: 'working' },
  { label: 'Ready', status: 'readyToLand' },
  { label: 'Awaiting reply', status: 'awaitingClarification' },
  { label: 'Landed', status: 'landed' },
];

export function Conversations() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusKey | 'all'>('all');
  const [query, setQuery] = useState('');
  const transport = useTransport();

  // Query is passed to the transport (small client-side filter today, but
  // semantically a search term). Status filter stays client-side since
  // status is a derived field, not a stored one.
  const conversationsQuery = useConversations({
    query: query.trim() || undefined,
  });

  const items = useMemo(() => {
    const data = conversationsQuery.data ?? [];
    if (filter === 'all') return data;
    return data.filter((c) => c.status === filter);
  }, [conversationsQuery.data, filter]);

  if (openId) {
    return <ConversationDetailView id={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 pt-3 pb-2.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="More filters">
            <Filter className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.status}
              type="button"
              onClick={() => setFilter(f.status)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                filter === f.status
                  ? 'border-foreground/40 bg-secondary text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {conversationsQuery.isLoading && <LoadingState rows={5} />}

        {conversationsQuery.isError && (
          <ErrorState
            title="Couldn't load conversations"
            description={
              <>
                The dock couldn't reach the local pinagent dev-server. Make sure your host app is
                running with the pinagent plugin, or append{' '}
                <code className="font-mono">?fixtures=on</code> to use the demo dataset.
              </>
            }
            onRetry={() => conversationsQuery.refetch()}
          />
        )}

        {conversationsQuery.isSuccess && items.length === 0 && (
          <EmptyState
            title={
              (conversationsQuery.data ?? []).length === 0
                ? 'No conversations yet'
                : 'No conversations match this filter'
            }
            description={
              (conversationsQuery.data ?? []).length === 0
                ? `Click any element on your host app with the pinagent picker to start one.${
                    transport.kind === 'mock' ? ' (Currently showing fixtures.)' : ''
                  }`
                : 'Try a different status or clear the search.'
            }
          />
        )}

        {items.length > 0 && (
          <div className="flex flex-col gap-1.5 p-3">
            {items.map((c) => (
              <ListRow
                key={c.id}
                status={c.status}
                title={c.title}
                onClick={() => setOpenId(c.id)}
                meta={
                  <>
                    {c.anchor.loc && <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />}
                    {c.page && (
                      <span className="truncate font-mono text-[10.5px]">{safePath(c.page)}</span>
                    )}
                    {c.messageCount > 0 && (
                      <span className="text-[10px] tabular-nums">· {c.messageCount} msg</span>
                    )}
                  </>
                }
                updatedAt={c.updatedAt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Detail view. Pulls the full record via `GET /__pinagent/feedback/:id`,
 * subscribes to the per-conversation WS bus for the transcript and
 * live agent events, and lets the user reply, land, or discard.
 *
 * Known limitation: the WS bus is kept in-memory with a ~5 minute TTL
 * after the agent finishes. Long-finished conversations show an empty
 * transcript with a placeholder — adding a persisted-messages HTTP
 * endpoint is follow-up work.
 */
function ConversationDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const transport = useTransport();
  const detailQuery = useConversation(id);
  const stream = useConversationStream(id);
  const isMock = transport.kind === 'mock';

  // Track whether we've sent at least one user message in this session
  // so the "no transcript" placeholder shows the right copy.
  const [reply, setReply] = useState('');
  const handleSend = (): void => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    transport.sendUserMessage(id, trimmed);
    setReply('');
  };

  if (detailQuery.isLoading) return <LoadingState rows={3} />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load this conversation"
        description="The dev-server didn't return the record. Make sure your host app is still running."
        onRetry={() => detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return (
      <EmptyState
        title="Conversation not found"
        description="It may have been discarded since the list loaded."
      />
    );
  }

  const detail = detailQuery.data;
  const worktreeState = stream.worktree?.state ?? null;
  const canLand = worktreeState === 'active' || worktreeState === 'ttl_warning';
  const canDiscard = canLand;
  const showLifecycleBusy = worktreeState === 'landing' || worktreeState === 'discarding';

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <DetailHeader detail={detail} onBack={onBack} worktreeState={stream.worktree} />

      <div className="flex-1 overflow-auto p-3 space-y-2">
        <OriginalComment comment={detail.comment} createdAt={detail.updatedAt} />
        <StreamView stream={stream} isMock={isMock} />
      </div>

      {(canLand || canDiscard || showLifecycleBusy) && (
        <div className="border-t border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {lifecycleLabel(stream.worktree)}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!canDiscard || showLifecycleBusy}
              onClick={() => transport.discardConversation(id)}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="accent"
              className="h-7 text-xs"
              disabled={!canLand || showLifecycleBusy}
              onClick={() => transport.landConversation(id)}
            >
              Land
            </Button>
          </div>
        </div>
      )}

      <div className="border-t border-border bg-card p-3 space-y-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={isMock ? 'Sending disabled in mock mode' : 'Reply to the agent…'}
          className="min-h-[64px] resize-y text-xs"
          disabled={isMock || stream.done}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {isMock
              ? 'Switch off ?fixtures=on to send real replies.'
              : stream.done
                ? 'Agent run finished. Start a new conversation to keep going.'
                : 'Shift + Enter for newline · Enter to send'}
          </span>
          <Button
            size="sm"
            className="h-7 gap-1.5"
            disabled={isMock || stream.done || !reply.trim()}
            onClick={handleSend}
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function lifecycleLabel(state: WorktreeStatePayload | null): string {
  if (!state) return 'Worktree state pending…';
  switch (state.state) {
    case 'none':
      return 'Inline mode — no worktree';
    case 'active':
      return `Working · ${state.changesCount ?? '—'} changes`;
    case 'landing':
      return 'Landing…';
    case 'landed':
      return state.commitSha ? `Landed as ${state.commitSha.slice(0, 7)}` : 'Landed';
    case 'discarding':
      return 'Discarding…';
    case 'discarded':
      return 'Discarded';
    case 'conflict':
      return `Conflicts in ${state.conflicts?.length ?? 0} file${(state.conflicts?.length ?? 0) === 1 ? '' : 's'}`;
    case 'ttl_warning':
      return 'Old worktree — review or discard';
  }
}

function DetailHeader({
  detail,
  onBack,
  worktreeState,
}: {
  detail: ConversationDetail;
  onBack: () => void;
  worktreeState: WorktreeStatePayload | null;
}) {
  return (
    <div className="border-b border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 -ml-1.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All conversations
        </Button>
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {detail.shortId}
        </Badge>
      </div>
      <h2 className="text-sm font-semibold leading-tight">{detail.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={detail.status} pulse={detail.status === 'working'} />
        {detail.anchor.loc && (
          <AnchorChip loc={detail.anchor.loc} selector={detail.anchor.selector} />
        )}
        {detail.branch && (
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {detail.branch}
          </span>
        )}
        {worktreeState && worktreeState.state === 'conflict' && (
          <Badge variant="destructive" className="text-[10px]">
            conflicts
          </Badge>
        )}
      </div>
    </div>
  );
}

function OriginalComment({ comment, createdAt }: { comment: string; createdAt: string }) {
  return (
    <div className="rounded-lg border border-foreground/20 bg-secondary/40 px-3 py-2 text-[12.5px] leading-relaxed">
      <div className="flex items-center gap-2 mb-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <span className="font-semibold text-foreground/80">You</span>
        <TimestampDot iso={createdAt} className="ml-auto" />
      </div>
      <p className="text-foreground whitespace-pre-wrap break-words">{comment}</p>
    </div>
  );
}

function StreamView({ stream, isMock }: { stream: ConversationStream; isMock: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin scroll to the bottom whenever new items arrive so live updates
  // stay in view without the user having to scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [stream.items.length]);

  if (stream.items.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-6 text-center text-xs text-muted-foreground"
      >
        {isMock
          ? 'Mock mode — no live stream.'
          : stream.done
            ? 'No transcript available (agent finished — bus expired). Submit a follow-up to start a new turn.'
            : 'Waiting for the agent to start…'}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="space-y-2">
      {stream.items.map((item, i) => (
        <StreamRow key={`${item.receivedAt}-${i}`} item={item} />
      ))}
      {stream.done && (
        <div className="text-center text-[11px] text-muted-foreground pt-1">
          — agent run finished —
        </div>
      )}
    </div>
  );
}

function StreamRow({ item }: { item: StreamItem }) {
  if (item.kind === 'error') {
    return (
      <div className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
        {item.message}
      </div>
    );
  }
  return <EventRow event={item.event} at={item.receivedAt} />;
}

function EventRow({ event, at }: { event: AgentEvent; at: string }) {
  switch (event.type) {
    case 'init':
      return (
        <RowFrame speaker="Agent" at={at} tone="meta">
          <p className="text-foreground/80 text-[12px]">
            Session started · model <code className="font-mono text-[11px]">{event.model}</code> ·{' '}
            {event.permissionMode}
          </p>
        </RowFrame>
      );
    case 'text':
      return (
        <RowFrame speaker="Agent" at={at}>
          <p className="text-foreground whitespace-pre-wrap break-words">{event.text}</p>
        </RowFrame>
      );
    case 'tool_use':
      return (
        <RowFrame speaker="Tool" at={at} tone="meta">
          <span className="font-mono text-[11px]">
            <span className="font-semibold">{event.name}</span>{' '}
            <span className="text-muted-foreground">{event.summary}</span>
          </span>
        </RowFrame>
      );
    case 'tool_result':
      return (
        <div
          className={cn(
            'rounded-md border px-2.5 py-1 text-[10.5px] font-mono',
            event.ok
              ? 'border-status-ready-border bg-status-ready-bg text-status-ready-fg'
              : 'border-status-error-border bg-status-error-bg text-status-error-fg',
          )}
        >
          {event.ok ? '✓ tool ok' : '✗ tool error'}
        </div>
      );
    case 'ask_user':
      return (
        <RowFrame speaker="Agent" at={at} tone="ask">
          <p className="font-medium text-status-awaiting-fg whitespace-pre-wrap">
            {event.question}
          </p>
          {event.context && (
            <p className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {event.context}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground italic">
            (Responding to ask_user inline lands in a follow-up — use the reply box below for now.)
          </p>
        </RowFrame>
      );
    case 'error':
      return (
        <div className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
          {event.message}
        </div>
      );
    case 'result':
      return (
        <RowFrame speaker="Agent" at={at} tone="meta">
          <p className="text-foreground/70 text-[11px]">
            Result · {event.numTurns} turn{event.numTurns === 1 ? '' : 's'} · {event.durationMs}ms ·
            ${event.totalCostUsd.toFixed(4)}
          </p>
        </RowFrame>
      );
    case 'status_changed':
      return (
        <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-[10.5px] text-muted-foreground">
          Status → <span className="font-semibold text-foreground">{event.status}</span>
        </div>
      );
  }
}

function RowFrame({
  speaker,
  at,
  tone,
  children,
}: {
  speaker: string;
  at: string;
  tone?: 'meta' | 'ask';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
        tone === 'meta'
          ? 'border-dashed border-border bg-secondary/20'
          : tone === 'ask'
            ? 'border-status-awaiting-border bg-status-awaiting-bg'
            : 'border-border bg-card shadow-[0_1px_2px_rgba(32,27,33,0.04)]',
      )}
    >
      <div className="flex items-center gap-2 mb-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <span className="font-semibold text-foreground/80">{speaker}</span>
        <TimestampDot iso={at} className="ml-auto" />
      </div>
      {children}
    </div>
  );
}

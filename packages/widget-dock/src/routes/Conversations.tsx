// SPDX-License-Identifier: Apache-2.0

import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { ArrowLeft, Filter, Search, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import type { Conversation } from '../fixtures';
import { useConversations } from '../hooks/useConversations';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';

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

  const active = openId ? (conversationsQuery.data?.find((c) => c.id === openId) ?? null) : null;

  if (active) return <ConversationDetail conversation={active} onBack={() => setOpenId(null)} />;

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
 * Detail view. PR-C wires this to GET /__pinagent/feedback/:id + the
 * messages query + per-conversation WS subscription. For now it renders
 * a static "details coming soon" panel using whatever shallow data the
 * list endpoint returned.
 */
function ConversationDetail({
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col min-h-0">
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
            {conversation.shortId}
          </Badge>
        </div>
        <h2 className="text-sm font-semibold leading-tight">{conversation.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={conversation.status} pulse={conversation.status === 'working'} />
          {conversation.anchor.loc && (
            <AnchorChip loc={conversation.anchor.loc} selector={conversation.anchor.selector} />
          )}
          {conversation.branch && (
            <span className="text-[11px] text-muted-foreground font-mono truncate">
              {conversation.branch}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Full transcript + live agent stream land in PR-C. Today this view shows whatever the list
          endpoint returned for this conversation.
        </div>
      </div>

      <div className="border-t border-border bg-card p-3 space-y-2">
        <Textarea
          placeholder="Reply to the agent…"
          className="min-h-[64px] resize-y text-xs"
          disabled
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Sending wires up in PR-C.</span>
          <Button size="sm" className="h-7 gap-1.5" disabled>
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

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
import { TimestampDot } from '../components/TimestampDot';
import { type Conversation, FIXTURE_CONVERSATIONS } from '../fixtures';

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

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FIXTURE_CONVERSATIONS.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false;
      if (q && !c.title.toLowerCase().includes(q) && !c.anchor.loc.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [filter, query]);

  const active = openId ? (FIXTURE_CONVERSATIONS.find((c) => c.id === openId) ?? null) : null;

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
        {items.length === 0 ? (
          <p className="px-3 py-12 text-center text-xs text-muted-foreground">
            No conversations match this filter.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5 p-3">
            {items.map((c) => (
              <ListRow
                key={c.id}
                status={c.status}
                title={c.title}
                onClick={() => setOpenId(c.id)}
                meta={
                  <>
                    <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />
                    <span className="truncate">{c.lastMessage}</span>
                    <span className="text-[10px] tabular-nums">· {c.messageCount} msg</span>
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
          <AnchorChip loc={conversation.anchor.loc} selector={conversation.anchor.selector} />
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {conversation.branch}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        <Message
          who="human"
          at={conversation.updatedAt}
          body={`Clicked on “${conversation.anchor.snippet}” — ${conversation.title.replace(/^.*?—\s*/, '')}.`}
        />
        <Message
          who="agent"
          at={conversation.updatedAt}
          body={conversation.lastMessage}
          tool="Edit"
        />
        <ToolStrip />
      </div>

      <div className="border-t border-border bg-card p-3 space-y-2">
        <Textarea placeholder="Reply to the agent…" className="min-h-[64px] resize-y text-xs" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Shift + Enter for newline · Enter to send
          </span>
          <Button size="sm" className="h-7 gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function Message({
  who,
  body,
  at,
  tool,
}: {
  who: 'human' | 'agent';
  body: string;
  at: string;
  tool?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
        who === 'human'
          ? 'border-foreground/20 bg-secondary/40'
          : 'border-border bg-card shadow-[0_1px_2px_rgba(32,27,33,0.04)]',
      )}
    >
      <div className="flex items-center gap-2 mb-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <span className="font-semibold text-foreground/80">
          {who === 'human' ? 'You' : 'Agent'}
        </span>
        {tool && (
          <span className="font-mono normal-case tracking-normal rounded bg-accent/30 px-1.5 py-0.5 text-[10px] text-foreground/80">
            {tool}
          </span>
        )}
        <TimestampDot iso={at} className="ml-auto" />
      </div>
      <p className="text-foreground">{body}</p>
    </div>
  );
}

function ToolStrip() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="font-mono">Read</span>{' '}
      <span className="font-mono text-foreground/70">src/marketing/Hero.tsx</span>
      <span className="mx-1.5">·</span>
      <span className="font-mono">Edit</span>{' '}
      <span className="font-mono text-foreground/70">+12 −4</span>
      <span className="mx-1.5">·</span>
      <span className="font-mono">Write</span>{' '}
      <span className="font-mono text-foreground/70">notes/hero-copy.md</span>
    </div>
  );
}

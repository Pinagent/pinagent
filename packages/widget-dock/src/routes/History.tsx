// SPDX-License-Identifier: Apache-2.0
/**
 * History — two tabs:
 *
 *   - Conversations: resolved conversations (landed, discarded,
 *     errored). Empty search → client-side filter over the
 *     conversations cache. Non-empty search → server-side full-text
 *     search via GET /__pinagent/history with matched-field hints.
 *
 *   - Activity: chronological audit feed of agent + user actions
 *     (created, landed, discarded, pr_created). Backed by
 *     GET /__pinagent/audit-log; invalidated alongside conversations
 *     so a land/discard shows up in the feed instantly.
 */

import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Input } from '@pinagent/ui/components/ui/input';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import {
  CheckCircle2,
  GitPullRequest,
  History as HistoryIcon,
  MessageSquarePlus,
  Search,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import { TimestampDot } from '../components/TimestampDot';
import { useAuditLog } from '../hooks/useAuditLog';
import { useConversations } from '../hooks/useConversations';
import { useDebouncedValue, useHistorySearch } from '../hooks/useHistorySearch';
import { EmptyState, ErrorState, LoadingState } from '../shell/states';
import type { AuditEvent, HistoryMatchedField, HistorySearchHit } from '../transport';

type Tab = 'conversations' | 'activity';

type HistoryFilter = 'all' | 'landed' | 'discarded' | 'error';
type StatusParam = 'all' | 'landed' | 'discarded';

const FILTERS: { label: string; key: HistoryFilter; matches: StatusKey[]; status: StatusParam }[] =
  [
    { label: 'All', key: 'all', matches: ['landed', 'discarded', 'error'], status: 'all' },
    { label: 'Landed', key: 'landed', matches: ['landed'], status: 'landed' },
    { label: 'Discarded', key: 'discarded', matches: ['discarded'], status: 'discarded' },
    { label: 'Errored', key: 'error', matches: ['error'], status: 'discarded' },
  ];

const RESOLVED_STATUSES: ReadonlySet<StatusKey> = new Set(['landed', 'discarded', 'error']);

const MATCH_LABEL: Record<HistoryMatchedField, string> = {
  comment: 'comment',
  note: 'note',
  branch: 'branch',
  anchor: 'file',
  selector: 'selector',
};

export function History() {
  const [tab, setTab] = useState<Tab>('conversations');
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 pt-3 pb-2 flex items-center gap-1">
        <TabButton active={tab === 'conversations'} onClick={() => setTab('conversations')}>
          Conversations
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
        </TabButton>
      </div>
      {tab === 'conversations' ? <ConversationsTab /> : <ActivityTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
      )}
    >
      {children}
    </button>
  );
}

function ConversationsTab() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  const conversationsQuery = useConversations();
  const searchQuery = useHistorySearch({ query: debouncedQuery, status: activeFilter.status });

  const isSearching = debouncedQuery.trim().length > 0;

  // Client-side filter mode (empty query).
  const filterItems = useMemo(() => {
    const data = conversationsQuery.data ?? [];
    return data.filter(
      (c) => RESOLVED_STATUSES.has(c.status) && activeFilter.matches.includes(c.status),
    );
  }, [conversationsQuery.data, activeFilter]);
  const resolvedCount = useMemo(
    () => (conversationsQuery.data ?? []).filter((c) => RESOLVED_STATUSES.has(c.status)).length,
    [conversationsQuery.data],
  );

  return (
    <>
      <div className="border-b border-border bg-card px-3 pt-3 pb-2.5 space-y-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search comments, files, branches, selectors…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                filter === f.key
                  ? 'border-foreground/40 bg-secondary text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50',
              )}
            >
              {f.label}
            </button>
          ))}
          {isSearching && searchQuery.isFetching && (
            <span className="ml-auto text-[11px] text-muted-foreground italic">Searching…</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!isSearching ? (
          <ClientFilterView
            query={conversationsQuery}
            items={filterItems}
            resolvedCount={resolvedCount}
          />
        ) : (
          <SearchView query={searchQuery} />
        )}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {isSearching
            ? 'Server-side full-text search over comments, notes, files, selectors, and branches.'
            : 'Showing the conversations cache · type to search the whole history.'}
        </p>
      </div>
    </>
  );
}

function ClientFilterView({
  query,
  items,
  resolvedCount,
}: {
  query: ReturnType<typeof useConversations>;
  items: NonNullable<ReturnType<typeof useConversations>['data']>;
  resolvedCount: number;
}) {
  if (query.isLoading) return <LoadingState rows={5} />;
  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't load history"
        description="The dock couldn't reach the local pinagent dev-server. Resolved conversations live with the rest — they'll appear once the server's back."
        onRetry={() => query.refetch()}
      />
    );
  }
  if (resolvedCount === 0) {
    return (
      <EmptyState
        Icon={HistoryIcon}
        title="Nothing resolved yet"
        description="Landed, discarded, and errored conversations appear here once they leave the active list."
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        Icon={HistoryIcon}
        title="No matches"
        description="Try a different status, or search the full history above."
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5 p-3">
      {items.map((c) => (
        <ListRow
          key={c.id}
          status={c.status}
          title={c.title}
          meta={
            <>
              {c.anchor.loc && <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />}
              {c.page && (
                <span className="truncate font-mono text-[10.5px]">{safePath(c.page)}</span>
              )}
            </>
          }
          updatedAt={c.updatedAt}
        />
      ))}
    </div>
  );
}

function SearchView({ query }: { query: ReturnType<typeof useHistorySearch> }) {
  if (query.isLoading) return <LoadingState rows={5} />;
  if (query.isError) {
    return (
      <ErrorState
        title="Search failed"
        description={query.error instanceof Error ? query.error.message : 'Unknown error'}
        onRetry={() => query.refetch()}
      />
    );
  }
  const hits = query.data ?? [];
  if (hits.length === 0) {
    return (
      <EmptyState
        Icon={HistoryIcon}
        title="No matches"
        description="Try a shorter query, a different status, or check the spelling."
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5 p-3">
      {hits.map((hit) => (
        <HitRow key={hit.id} hit={hit} />
      ))}
    </div>
  );
}

function HitRow({ hit }: { hit: HistorySearchHit }) {
  const status: StatusKey =
    hit.worktreeState === 'landed'
      ? 'landed'
      : hit.worktreeState === 'discarded' || hit.status === 'wontfix'
        ? 'discarded'
        : 'pending';
  const title = firstLine(hit.comment);
  const loc = locString(hit.file, hit.line, hit.col);
  return (
    <article className="group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <StatusBadge status={status} variant="dot" className="mt-1.5 pointer-events-none" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
            {title}
          </span>
          <TimestampDot iso={hit.resolvedAt ?? hit.updatedAt} className="mt-0.5" />
        </div>
        {hit.snippet && (
          <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed line-clamp-2">
            {hit.snippet}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {loc && <AnchorChip loc={loc} selector={hit.selector} />}
          {hit.url && <span className="truncate font-mono text-[10.5px]">{safePath(hit.url)}</span>}
          {hit.branch && <span className="truncate font-mono text-[10.5px]">{hit.branch}</span>}
          {hit.matchedFields.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              matched: {hit.matchedFields.map((f) => MATCH_LABEL[f]).join(', ')}
            </Badge>
          )}
        </div>
      </div>
    </article>
  );
}

function ActivityTab() {
  const auditQuery = useAuditLog({ limit: 200 });
  const events = auditQuery.data ?? [];

  return (
    <>
      <div className="flex-1 overflow-auto">
        {auditQuery.isLoading ? (
          <LoadingState rows={5} />
        ) : auditQuery.isError ? (
          <ErrorState
            title="Couldn't load activity"
            description={
              auditQuery.error instanceof Error
                ? auditQuery.error.message
                : "The dock couldn't reach the local pinagent dev-server."
            }
            onRetry={() => auditQuery.refetch()}
          />
        ) : events.length === 0 ? (
          <EmptyState
            Icon={HistoryIcon}
            title="No activity yet"
            description="Conversations created, landed, and discarded — plus PRs the composer opens — will appear here."
          />
        ) : (
          <ol className="flex flex-col gap-1 p-3">
            {events.map((e) => (
              <ActivityRow key={e.id} event={e} />
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {events.length === 0
            ? 'Audit feed updates live as the agent and you work.'
            : `${events.length} action${events.length === 1 ? '' : 's'} · newest first.`}
        </p>
      </div>
    </>
  );
}

interface ActivityVisual {
  Icon: typeof HistoryIcon;
  status: StatusKey;
  label: string;
}

function describeEvent(event: AuditEvent): ActivityVisual {
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

function ActivityRow({ event }: { event: AuditEvent }) {
  const visual = describeEvent(event);
  const meta = activityMeta(event);
  const Icon = visual.Icon;
  return (
    <li className="group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2">
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
    </li>
  );
}

function activityMeta(event: AuditEvent): React.ReactNode | null {
  const parts: React.ReactNode[] = [];
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

function firstLine(text: string): string {
  const trimmed = (text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? text).trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function locString(file: string | null, line: number | null, col: number | null): string {
  if (!file) return '';
  if (line == null) return file;
  if (col == null) return `${file}:${line}`;
  return `${file}:${line}:${col}`;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

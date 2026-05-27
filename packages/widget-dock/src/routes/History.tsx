// SPDX-License-Identifier: Apache-2.0
/**
 * History — resolved conversations (landed, discarded, errored). Uses
 * the same useConversations hook as Conversations + a status filter so
 * the cache stays shared. Phase 6 ships proper full-text search + an
 * audit log; the search input here is client-side over loaded rows.
 */

import { Input } from '@pinagent/ui/components/ui/input';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { History as HistoryIcon, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import { useConversations } from '../hooks/useConversations';
import { EmptyState, ErrorState, LoadingState } from '../shell/states';

type HistoryFilter = 'all' | 'landed' | 'discarded' | 'error';

const FILTERS: { label: string; key: HistoryFilter; matches: StatusKey[] }[] = [
  { label: 'All', key: 'all', matches: ['landed', 'discarded', 'error'] },
  { label: 'Landed', key: 'landed', matches: ['landed'] },
  { label: 'Discarded', key: 'discarded', matches: ['discarded'] },
  { label: 'Errored', key: 'error', matches: ['error'] },
];

const RESOLVED_STATUSES: ReadonlySet<StatusKey> = new Set(['landed', 'discarded', 'error']);

export function History() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [query, setQuery] = useState('');

  const conversationsQuery = useConversations();

  const resolved = useMemo(() => {
    const data = conversationsQuery.data ?? [];
    return data.filter((c) => RESOLVED_STATUSES.has(c.status));
  }, [conversationsQuery.data]);

  const items = useMemo(() => {
    const matches = FILTERS.find((f) => f.key === filter)?.matches ?? [];
    const trimmedQuery = query.trim().toLowerCase();
    return resolved.filter((c) => {
      if (!matches.includes(c.status)) return false;
      if (!trimmedQuery) return true;
      return (
        c.title.toLowerCase().includes(trimmedQuery) ||
        c.anchor.loc.toLowerCase().includes(trimmedQuery) ||
        c.anchor.selector.toLowerCase().includes(trimmedQuery) ||
        c.page.toLowerCase().includes(trimmedQuery)
      );
    });
  }, [resolved, filter, query]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 pt-3 pb-2.5 space-y-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resolved conversations"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
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
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {conversationsQuery.isLoading && <LoadingState rows={5} />}

        {conversationsQuery.isError && (
          <ErrorState
            title="Couldn't load history"
            description="The dock couldn't reach the local pinagent dev-server. Resolved conversations live with the rest — they'll appear once the server's back."
            onRetry={() => conversationsQuery.refetch()}
          />
        )}

        {conversationsQuery.isSuccess && resolved.length === 0 && (
          <EmptyState
            Icon={HistoryIcon}
            title="Nothing resolved yet"
            description="Landed, discarded, and errored conversations appear here once they leave the active list."
          />
        )}

        {conversationsQuery.isSuccess && resolved.length > 0 && items.length === 0 && (
          <EmptyState
            Icon={HistoryIcon}
            title="No matches"
            description="Try a different filter or clear the search."
          />
        )}

        {items.length > 0 && (
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
        )}
      </div>

      <div className="border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Client-side search · full-text + audit log ship with Phase 6.
        </p>
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

// SPDX-License-Identifier: Apache-2.0

import { Button } from '@pinagent/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pinagent/ui/components/ui/dropdown-menu';
import { Input } from '@pinagent/ui/components/ui/input';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Check, Filter, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { AnchorContext } from '../components/AnchorContext';
import { CostChip } from '../components/CostChip';
import { ListRow } from '../components/ListRow';
import { useBulkArchive } from '../hooks/useBulkArchive';
import { useConversations } from '../hooks/useConversations';
import {
  type ConversationFilterState,
  matchesPreset,
  useSavedFilters,
} from '../hooks/useSavedFilters';
import { useSettings } from '../hooks/useSettings';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { OnboardingState } from '../shell/states/OnboardingState';
import { useTransport } from '../transport';
import { ConversationDetailView } from './ConversationDetail';

const STATUS_FILTERS: { label: string; status: StatusKey | 'all' }[] = [
  { label: 'All', status: 'all' },
  { label: 'Working', status: 'working' },
  { label: 'Ready', status: 'readyToLand' },
  { label: 'Awaiting reply', status: 'awaitingClarification' },
  { label: 'Landed', status: 'landed' },
];

export function Conversations() {
  // `?id=<conversation-id>` drives the detail view. Sourcing it from
  // the URL (not local state) makes detail pages share-able as deep
  // links, integrates with browser back/forward, and survives the
  // dock's open/close — closing then reopening with the same URL
  // restores the same conversation.
  const { id: openId } = useSearch({ from: '/conversations' });
  const navigate = useNavigate();
  const openConversation = useCallback(
    (id: string) => {
      void navigate({ to: '/conversations', search: { id } });
    },
    [navigate],
  );
  const closeConversation = useCallback(() => {
    void navigate({ to: '/conversations', search: {} });
  }, [navigate]);

  const [filter, setFilter] = useState<StatusKey | 'all'>('all');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // Saved-filter presets — built-ins plus user-saved combinations of
  // (status, query, showArchived). `isNaming` toggles the inline
  // name input above the filter row.
  const savedFilters = useSavedFilters();
  const [isNaming, setIsNaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const currentState: ConversationFilterState = useMemo(
    () => ({ statusFilter: filter, query, showArchived }),
    [filter, query, showArchived],
  );
  const activePreset = useMemo(
    () => savedFilters.presets.find((p) => matchesPreset(currentState, p)),
    [savedFilters.presets, currentState],
  );
  const applyPreset = useCallback((state: ConversationFilterState) => {
    setFilter(state.statusFilter);
    setQuery(state.query);
    setShowArchived(state.showArchived);
  }, []);
  const startSavingPreset = useCallback(() => {
    setDraftName('');
    setIsNaming(true);
  }, []);
  const cancelSavingPreset = useCallback(() => {
    setIsNaming(false);
    setDraftName('');
  }, []);
  const commitSavingPreset = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      cancelSavingPreset();
      return;
    }
    savedFilters.savePreset(trimmed, currentState);
    setIsNaming(false);
    setDraftName('');
  }, [draftName, savedFilters, currentState, cancelSavingPreset]);
  useEffect(() => {
    if (isNaming) nameInputRef.current?.focus();
  }, [isNaming]);
  // Selection set for bulk archive. Keyed on conversation id. Cleared
  // on filter / search / show-archived change so the user can't
  // accidentally bulk-archive rows that have scrolled out of view.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const transport = useTransport();
  const bulkArchive = useBulkArchive();

  // Query is passed to the transport (small client-side filter today, but
  // semantically a search term). Status filter stays client-side since
  // status is a derived field, not a stored one. `includeArchived` is
  // forwarded so the transport drops archived rows before they reach
  // the cache — flipping the toggle invalidates the cache via the
  // query key and refetches without archived stragglers.
  const conversationsQuery = useConversations({
    query: query.trim() || undefined,
    includeArchived: showArchived,
  });

  // Settings is small + cached; reading it here lets the list-row cost
  // chip color-shift as a conversation approaches its per-conversation
  // cap. `undefined` while loading → chip falls back to "no cap" view.
  const settingsQuery = useSettings();
  const capUsd = settingsQuery.data?.perConversationCapUsd;

  const items = useMemo(() => {
    const data = conversationsQuery.data ?? [];
    if (filter === 'all') return data;
    return data.filter((c) => c.status === filter);
  }, [conversationsQuery.data, filter]);

  const toggleSelected = useCallback((id: string, next: boolean) => {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Compute select-all state from the currently-visible items. The
  // bulk bar uses the full `selected` set (which may include rows that
  // scrolled out of view via a filter change), but the header
  // checkbox is scoped to what's currently rendered.
  const visibleSelectedCount = useMemo(
    () => items.filter((c) => selected.has(c.id)).length,
    [items, selected],
  );
  const allVisibleSelected = items.length > 0 && visibleSelectedCount === items.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);
  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const out = new Set(prev);
      if (allVisibleSelected) {
        // All visible were selected → deselect those (keep any not-visible
        // selections in place).
        for (const c of items) out.delete(c.id);
      } else {
        for (const c of items) out.add(c.id);
      }
      return out;
    });
  }, [allVisibleSelected, items]);

  // Drive bulk archive direction from the SELECTED rows, not the
  // visible ones — if every selected row is archived, the user wants
  // unarchive; if any is unarchived, archive wins (rows already
  // archived are skipped server-side).
  const allConversations = conversationsQuery.data ?? [];
  const selectedConversations = useMemo(
    () => allConversations.filter((c) => selected.has(c.id)),
    [allConversations, selected],
  );
  const allSelectedArchived =
    selectedConversations.length > 0 && selectedConversations.every((c) => c.archived);

  const runBulkArchive = (archived: boolean): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    bulkArchive.mutate(
      { ids, archived },
      {
        onSuccess: () => clearSelection(),
      },
    );
  };

  if (openId) {
    // `key` on the detail view forces a fresh mount per conversation so
    // optimistic state, answered ask ids, and lifecycle intent from one
    // conversation can't leak into another.
    return <ConversationDetailView key={openId} id={openId} onBack={closeConversation} />;
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
              type="search"
              aria-label="Search conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                aria-label="Saved filter presets"
                title={activePreset ? `Preset: ${activePreset.name}` : 'Filter presets'}
              >
                <Filter className="h-3.5 w-3.5" />
                <span className="max-w-[100px] truncate">{activePreset?.name ?? 'Presets'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                Built-in
              </DropdownMenuLabel>
              {savedFilters.presets
                .filter((p) => p.builtin)
                .map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => applyPreset(p)}
                    className={cn(
                      'gap-2 text-sm',
                      matchesPreset(currentState, p) && 'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {matchesPreset(currentState, p) ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="w-3.5" aria-hidden />
                    )}
                    {p.name}
                  </DropdownMenuItem>
                ))}
              {savedFilters.presets.some((p) => !p.builtin) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Saved
                  </DropdownMenuLabel>
                  {savedFilters.presets
                    .filter((p) => !p.builtin)
                    .map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        // Don't onSelect → handle apply on the row,
                        // delete on its trailing button.
                        asChild
                        className={cn(
                          'gap-2 text-sm',
                          matchesPreset(currentState, p) &&
                            'bg-secondary text-secondary-foreground',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {matchesPreset(currentState, p) ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <span className="w-3.5" aria-hidden />
                          )}
                          <button
                            type="button"
                            onClick={() => applyPreset(p)}
                            className="flex-1 truncate text-left"
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              savedFilters.deletePreset(p.id);
                            }}
                            aria-label={`Delete preset ${p.name}`}
                            className="text-muted-foreground/60 hover:text-status-error-fg"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </DropdownMenuItem>
                    ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => startSavingPreset()}
                disabled={activePreset !== undefined}
                className="gap-2 text-xs text-muted-foreground"
              >
                <span className="w-3.5" aria-hidden />
                {activePreset ? 'Already a preset' : 'Save current view…'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isNaming && (
          <div className="flex items-center gap-1.5">
            <Input
              ref={nameInputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitSavingPreset();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelSavingPreset();
                }
              }}
              placeholder="Preset name (e.g. Ready to land · mine)"
              aria-label="Preset name"
              className="h-7 text-xs"
              maxLength={64}
            />
            <Button
              size="sm"
              variant="default"
              onClick={commitSavingPreset}
              disabled={draftName.trim().length === 0}
              className="h-7 text-xs"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelSavingPreset}
              className="h-7 px-2 text-xs"
              aria-label="Cancel saving preset"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.status}
              type="button"
              onClick={() => setFilter(f.status)}
              aria-pressed={filter === f.status}
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
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            className={cn(
              'ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              showArchived
                ? 'border-foreground/40 bg-secondary text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50',
            )}
            title={
              showArchived
                ? 'Currently showing archived conversations — click to hide'
                : 'Click to include archived conversations'
            }
          >
            <Archive className="h-3 w-3" aria-hidden />
            Archived
          </button>
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

        {conversationsQuery.isSuccess &&
          items.length === 0 &&
          ((conversationsQuery.data ?? []).length === 0 ? (
            // First-time: project has zero conversations. Show the
            // full walkthrough pointing at the per-element widget.
            <OnboardingState
              title="Start your first conversation"
              intro={
                transport.kind === 'mock' ? (
                  <>
                    Running on fixtures — switch off <code className="font-mono">?fixtures=on</code>{' '}
                    to see real data. The walkthrough below is what new users see on first dock
                    open.
                  </>
                ) : undefined
              }
            />
          ) : (
            // Project has rows but none match the current filter +
            // search combo. Keep the lightweight EmptyState here.
            <EmptyState
              title="No conversations match this filter"
              description="Try a different status or clear the search."
            />
          ))}

        {items.length > 0 && (
          <div className="flex flex-col gap-1.5 p-3">
            <label className="flex items-center gap-2 px-3 text-[11px] text-muted-foreground">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label={
                  allVisibleSelected
                    ? `Deselect all ${items.length} conversations`
                    : `Select all ${items.length} conversations`
                }
                className="h-3.5 w-3.5 rounded border-border accent-foreground cursor-pointer"
              />
              <span>
                {items.length} conversation{items.length === 1 ? '' : 's'}
                {visibleSelectedCount > 0 && (
                  <span className="ml-1 text-foreground">· {visibleSelectedCount} selected</span>
                )}
              </span>
            </label>
            {items.map((c) => (
              <ListRow
                key={c.id}
                status={c.status}
                title={c.title}
                onClick={() => openConversation(c.id)}
                selected={selected.has(c.id)}
                onSelectChange={(next) => toggleSelected(c.id, next)}
                selectLabel={`Select ${c.title}`}
                meta={
                  <>
                    {c.archived && <span className="text-[10px]">archived</span>}
                    {c.anchor.loc && <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />}
                    <AnchorContext anchor={c.anchor} />
                    {c.page && (
                      <span className="truncate font-mono text-[10.5px]">{safePath(c.page)}</span>
                    )}
                    {c.messageCount > 0 && (
                      <span className="text-[10px] tabular-nums">· {c.messageCount} msg</span>
                    )}
                    {c.totalCostUsd > 0 && (
                      <CostChip
                        cost={c.totalCostUsd}
                        cap={capUsd}
                        prefix="· "
                        apiKeySource={c.apiKeySource}
                      />
                    )}
                  </>
                }
                updatedAt={c.updatedAt}
              />
            ))}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <section
          aria-label="Bulk actions"
          className={cn('border-t border-border bg-card px-3 py-2', 'flex items-center gap-2')}
        >
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-1.5">
            {allSelectedArchived ? (
              <Button
                size="sm"
                variant="default"
                onClick={() => runBulkArchive(false)}
                disabled={bulkArchive.isPending}
                className="h-7 gap-1.5 text-xs"
              >
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                Unarchive {selected.size}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="default"
                onClick={() => runBulkArchive(true)}
                disabled={bulkArchive.isPending}
                className="h-7 gap-1.5 text-xs"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden />
                Archive {selected.size}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={bulkArchive.isPending}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
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

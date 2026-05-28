// SPDX-License-Identifier: Apache-2.0

import type { AgentEvent } from '@pinagent/shared';
import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Badge } from '@pinagent/ui/components/ui/badge';
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
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ClipboardCopy,
  Filter,
  Pencil,
  Search,
  Send,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import { TimestampDot } from '../components/TimestampDot';
import { useBulkArchive } from '../hooks/useBulkArchive';
import { useConversation } from '../hooks/useConversation';
import {
  type ConversationStream,
  type StreamItem,
  useConversationStream,
} from '../hooks/useConversationStream';
import { useConversations } from '../hooks/useConversations';
import {
  type ConversationFilterState,
  matchesPreset,
  useSavedFilters,
} from '../hooks/useSavedFilters';
import { useUpdateConversation } from '../hooks/useUpdateConversation';
import { permissionModeDisplay } from '../lib/permissionMode';
import { copyClaudeCommand, openInClaudeCode } from '../lib/vscode-bridge';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { OnboardingState } from '../shell/states/OnboardingState';
import { type ConversationDetail, useTransport, type WorktreeStatePayload } from '../transport';
import {
  LIFECYCLE_TIMEOUT_MS,
  type LifecycleError,
  type LifecycleIntent,
  lifecycleTimeoutState,
  reduceLifecycleOnWorktreeState,
} from './conversation-lifecycle';

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

/**
 * Detail view. Pulls the full record via `GET /__pinagent/feedback/:id`,
 * subscribes to the per-conversation WS bus for the transcript and
 * live agent events, and lets the user reply, land, or discard.
 *
 * Transcript persistence: every bus event is written to the SQLite
 * `messages` table (see `agent-runner/src/bus.ts`). On subscribe, the
 * bus replays the full history before streaming live events — so even
 * long-finished conversations show their transcript. The HTTP
 * `GET /__pinagent/feedback/:id/messages` endpoint reads the same
 * source for callers that don't want a WS (external CLI, exports).
 */
/**
 * One locally-pushed item that hasn't come back over the WS yet. Used
 * so user actions feel instantaneous instead of waiting on the agent's
 * next bus emission. Rendered inline in the transcript next to the real
 * stream items, ordered by `receivedAt`.
 */
type OptimisticItem =
  | { kind: 'user_message'; id: number; content: string; receivedAt: string }
  | { kind: 'ask_response'; id: number; askId: string; answer: string; receivedAt: string };

function ConversationDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const transport = useTransport();
  const detailQuery = useConversation(id);
  const stream = useConversationStream(id);
  const isMock = transport.kind === 'mock';

  // Pick the latest init event's permissionMode so the header reflects
  // the mode this run is *currently* using — important across follow-up
  // turns, where each turn emits its own init and the user may have
  // changed the setting in between.
  const activePermissionMode = useMemo<string | null>(() => {
    for (let i = stream.items.length - 1; i >= 0; i--) {
      const it = stream.items[i];
      if (it?.kind !== 'event') continue;
      if (it.event.type === 'init') return it.event.permissionMode;
    }
    return null;
  }, [stream.items]);

  const [reply, setReply] = useState('');
  const [optimisticItems, setOptimisticItems] = useState<OptimisticItem[]>([]);
  const [answeredAskIds, setAnsweredAskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [intent, setIntent] = useState<LifecycleIntent>(null);
  const [lifecycleError, setLifecycleError] = useState<LifecycleError>(null);
  const optimisticIdRef = useRef(0);

  const handleSend = (): void => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    transport.sendUserMessage(id, trimmed);
    const optimisticId = ++optimisticIdRef.current;
    setOptimisticItems((prev) => [
      ...prev,
      {
        kind: 'user_message',
        id: optimisticId,
        content: trimmed,
        receivedAt: new Date().toISOString(),
      },
    ]);
    setReply('');
  };

  const handleAnswerAsk = (askId: string, answer: string): void => {
    transport.sendAskResponse(askId, answer);
    setAnsweredAskIds((prev) => {
      const next = new Set(prev);
      next.add(askId);
      return next;
    });
    const optimisticId = ++optimisticIdRef.current;
    setOptimisticItems((prev) => [
      ...prev,
      {
        kind: 'ask_response',
        id: optimisticId,
        askId,
        answer,
        receivedAt: new Date().toISOString(),
      },
    ]);
  };

  // Watch worktree-state transitions and apply the reducer — decision
  // logic lives in `reduceLifecycleOnWorktreeState` so it's testable
  // without rendering.
  const worktreeState = stream.worktree?.state ?? null;
  useEffect(() => {
    const next = reduceLifecycleOnWorktreeState(
      intent,
      worktreeState,
      stream.worktree?.conflicts?.length ?? 0,
    );
    if (next) {
      setIntent(next.intent);
      setLifecycleError(next.error);
    }
  }, [intent, worktreeState, stream.worktree]);

  // Timeout watchdog: if LIFECYCLE_TIMEOUT_MS elapse without a
  // confirming transition, surface a Retry option. The fire-the-timeout
  // decision lives in `lifecycleTimeoutState` (pure).
  useEffect(() => {
    if (!intent) return;
    const fire = (): void => {
      const fired = lifecycleTimeoutState(intent, Date.now());
      if (fired) {
        setIntent(fired.intent);
        setLifecycleError(fired.error);
      }
    };
    const remaining = LIFECYCLE_TIMEOUT_MS - (Date.now() - intent.sentAt);
    if (remaining <= 0) {
      fire();
      return;
    }
    const handle = setTimeout(fire, remaining);
    return () => clearTimeout(handle);
  }, [intent]);

  const performLand = (): void => {
    setLifecycleError(null);
    setIntent({ kind: 'land', sentAt: Date.now() });
    transport.landConversation(id);
  };

  const performDiscard = (): void => {
    setLifecycleError(null);
    setIntent({ kind: 'discard', sentAt: Date.now() });
    transport.discardConversation(id);
  };

  const performReopen = (): void => {
    setLifecycleError(null);
    setIntent({ kind: 'reopen', sentAt: Date.now() });
    transport.reopenConversation(id);
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
  const canLand = worktreeState === 'active' || worktreeState === 'ttl_warning';
  const canDiscard = canLand;
  const canReopen = worktreeState === 'landed' || worktreeState === 'discarded';
  const wsBusy = worktreeState === 'landing' || worktreeState === 'discarding';
  const showLifecycleBusy = wsBusy || intent !== null;
  const showActionRow =
    canLand || canDiscard || canReopen || showLifecycleBusy || lifecycleError !== null;

  // The server's `status` field only flips on a terminal `resolve_feedback`
  // call — it doesn't track "agent started working" or "ask_user paused".
  // The live event stream does, so we override the cached status from
  // stream activity to keep the timeline + header badge honest.
  const effectiveStatus = deriveEffectiveStatus(detail.status, stream.items, answeredAskIds);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <DetailHeader
        detail={detail}
        onBack={onBack}
        worktreeState={stream.worktree}
        permissionMode={activePermissionMode}
        effectiveStatus={effectiveStatus}
      />
      <StatusTimeline
        status={effectiveStatus}
        worktreeState={stream.worktree}
        createdAt={detail.updatedAt}
      />

      <div className="flex-1 overflow-auto p-3 space-y-2">
        <OriginalComment comment={detail.comment} createdAt={detail.updatedAt} />
        <StreamView
          stream={stream}
          isMock={isMock}
          optimistic={optimisticItems}
          answeredAskIds={answeredAskIds}
          onAnswerAsk={handleAnswerAsk}
          askDisabled={isMock}
        />
      </div>

      {lifecycleError && (
        <div className="border-t border-status-error-border bg-status-error-bg px-3 py-2 flex items-center gap-2 text-[12px] text-status-error-fg">
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 leading-snug">{lifecycleError.message}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px]"
            onClick={
              lifecycleError.kind === 'land'
                ? performLand
                : lifecycleError.kind === 'discard'
                  ? performDiscard
                  : performReopen
            }
          >
            Retry
          </Button>
        </div>
      )}

      {showActionRow && (
        <div className="border-t border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {intent
              ? intent.kind === 'land'
                ? 'Landing…'
                : intent.kind === 'discard'
                  ? 'Discarding…'
                  : 'Reopening…'
              : lifecycleLabel(stream.worktree)}
          </span>
          <div className="flex items-center gap-1.5">
            {canReopen ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={showLifecycleBusy}
                onClick={performReopen}
              >
                Re-open
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!canDiscard || showLifecycleBusy}
                  onClick={performDiscard}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="accent"
                  className="h-7 text-xs"
                  disabled={!canLand || showLifecycleBusy}
                  onClick={performLand}
                >
                  Land
                </Button>
              </>
            )}
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
          disabled={isMock}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {isMock
              ? 'Switch off ?fixtures=on to send real replies.'
              : 'Shift + Enter for newline · Enter to send'}
          </span>
          <Button
            size="sm"
            className="h-7 gap-1.5"
            disabled={isMock || !reply.trim()}
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
  permissionMode,
  effectiveStatus,
}: {
  detail: ConversationDetail;
  onBack: () => void;
  worktreeState: WorktreeStatePayload | null;
  permissionMode: string | null;
  effectiveStatus: StatusKey;
}) {
  const update = useUpdateConversation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(detail.title);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Focus + select on edit open. Run after the render that flips
  // `editingTitle` to true so the input element exists.
  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  const startRename = (): void => {
    setDraftTitle(detail.title);
    setEditingTitle(true);
  };
  const cancelRename = (): void => {
    setEditingTitle(false);
    setDraftTitle(detail.title);
  };
  const commitRename = (): void => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim();
    if (trimmed === detail.title.trim()) return;
    // Empty string clears back to the comment-derived title (storage
    // collapses to NULL). Otherwise persist the user's override.
    update.mutate({ id: detail.id, patch: { title: trimmed.length === 0 ? '' : trimmed } });
  };

  const toggleArchive = (): void => {
    update.mutate({ id: detail.id, patch: { archived: !detail.archived } });
  };

  const openInClaude = (): void => {
    openInClaudeCode(detail.comment);
  };

  const copyClaude = (): void => {
    // Fire-and-forget — `navigator.clipboard.writeText` can reject when
    // the document isn't focused (e.g. iframe edge cases), but there's
    // nothing meaningful to retry. The menu closing on click is the
    // user-visible signal that the action was taken.
    void copyClaudeCommand(detail.comment);
  };

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
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label="Hand this conversation to Claude Code"
                title="Hand off to Claude Code"
              >
                <Terminal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={openInClaude} className="gap-2 text-sm">
                <Terminal className="h-3.5 w-3.5" />
                Open in Claude Code (VSCode)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyClaude} className="gap-2 text-sm">
                <ClipboardCopy className="h-3.5 w-3.5" />
                Copy <code className="font-mono text-[11px]">claude</code> command
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleArchive}
            disabled={update.isPending}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={detail.archived ? 'Unarchive conversation' : 'Archive conversation'}
            title={detail.archived ? 'Unarchive conversation' : 'Archive conversation'}
          >
            {detail.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {detail.shortId}
        </Badge>
      </div>
      {editingTitle ? (
        <Input
          ref={titleInputRef}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelRename();
            }
          }}
          onBlur={commitRename}
          placeholder="Title (empty to use the original comment)"
          aria-label="Conversation title"
          className="h-7 text-sm font-semibold"
        />
      ) : (
        <button
          type="button"
          onClick={startRename}
          aria-label={`Rename conversation: ${detail.title}`}
          className={cn(
            'group flex w-full items-center gap-1.5 rounded -mx-1 px-1 py-0.5 text-left',
            'hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          )}
        >
          <h2 className="flex-1 text-sm font-semibold leading-tight truncate">{detail.title}</h2>
          <Pencil
            className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground"
            aria-hidden
          />
        </button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={effectiveStatus} pulse={effectiveStatus === 'working'} />
        {detail.archived && (
          <Badge variant="outline" className="text-[10px]">
            archived
          </Badge>
        )}
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
        {permissionMode &&
          (() => {
            const display = permissionModeDisplay(permissionMode);
            return (
              <Badge variant="outline" className="text-[10px]" title={display.title}>
                {display.label}
              </Badge>
            );
          })()}
      </div>
    </div>
  );
}

/**
 * Override the server-cached status with live signal from the event
 * stream. The server only flips `status` on a terminal `resolve_feedback`
 * call — it never publishes intermediate "agent started working" or
 * "ask_user paused" transitions, so the cached status sits at `pending`
 * for the entire active phase of a run. We reconstruct both transitions
 * from the stream:
 *
 *   - If the most recent stream item is an unanswered `ask_user`,
 *     we're awaiting clarification (regardless of cached status).
 *   - If the cached status is `pending` but the stream has any agent
 *     activity, we've moved into `working`.
 *
 * `answeredAskIds` covers the optimistic gap between the user sending an
 * answer and the agent emitting its next event. Terminal cached statuses
 * (landed, discarded, error, readyToLand) win over live signal — those
 * reflect explicit lifecycle decisions, not transient pause state.
 */
function deriveEffectiveStatus(
  base: StatusKey,
  items: readonly StreamItem[],
  answeredAskIds: ReadonlySet<string>,
): StatusKey {
  if (base === 'landed' || base === 'discarded' || base === 'error' || base === 'readyToLand') {
    return base;
  }
  const last = items[items.length - 1];
  if (
    last &&
    last.kind === 'event' &&
    last.event.type === 'ask_user' &&
    !answeredAskIds.has(last.event.askId)
  ) {
    return 'awaitingClarification';
  }
  if (base === 'pending' && items.length > 0) return 'working';
  return base;
}

/**
 * Horizontal stepper showing where this conversation is in its lifecycle.
 * Derived from the read-side status + the live worktree state — both
 * accurate without polling.
 *
 * Steps are coarse on purpose: the dock surfaces five user-meaningful
 * phases (submitted → working → awaiting → ready → resolved). Anchor-lost
 * + error states are rendered as a destination indicator on the current
 * step rather than a separate phase, since they're conditions to act on,
 * not stages to progress through.
 */
function StatusTimeline({
  status,
  worktreeState,
  createdAt,
}: {
  status: StatusKey;
  worktreeState: WorktreeStatePayload | null;
  createdAt: string;
}) {
  type Phase = 'submitted' | 'working' | 'awaiting' | 'ready' | 'resolved';
  const PHASES: { key: Phase; label: string }[] = [
    { key: 'submitted', label: 'Submitted' },
    { key: 'working', label: 'Working' },
    { key: 'awaiting', label: 'Awaiting reply' },
    { key: 'ready', label: 'Ready' },
    { key: 'resolved', label: 'Resolved' },
  ];

  const PHASE_BY_STATUS: Record<StatusKey, Phase> = {
    pending: 'submitted',
    working: 'working',
    anchorLost: 'working',
    awaitingClarification: 'awaiting',
    readyToLand: 'ready',
    landed: 'resolved',
    discarded: 'resolved',
    error: 'resolved',
  };
  const currentPhase = PHASE_BY_STATUS[status];
  const currentIdx = PHASES.findIndex((p) => p.key === currentPhase);

  const resolvedLabel =
    status === 'landed'
      ? worktreeState?.state === 'landed' && worktreeState.commitSha
        ? `Landed · ${worktreeState.commitSha.slice(0, 7)}`
        : 'Landed'
      : status === 'discarded'
        ? 'Discarded'
        : status === 'error'
          ? 'Errored'
          : 'Resolved';

  return (
    <ol
      aria-label="Conversation status timeline"
      className="flex items-center gap-1.5 border-b border-border bg-secondary/30 px-3 py-2 overflow-x-auto"
    >
      {PHASES.map((phase, idx) => {
        const isPast = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isFuture = idx > currentIdx;
        const label = phase.key === 'resolved' && isCurrent ? resolvedLabel : phase.label;
        return (
          <li key={phase.key} className="flex items-center gap-1.5 shrink-0">
            <span
              aria-hidden
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                isCurrent && 'h-2 w-2 ring-2 ring-offset-1 ring-offset-secondary',
                isPast && 'bg-foreground/80',
                isCurrent && status === 'error'
                  ? 'bg-status-error-fg ring-status-error-border'
                  : isCurrent && status === 'working'
                    ? 'bg-status-working-fg ring-status-working-border animate-pulse motion-reduce:animate-none'
                    : isCurrent && 'bg-status-ready-fg ring-status-ready-border',
                isFuture && 'bg-border',
              )}
            />
            <span
              className={cn(
                'text-[11px] tracking-tight whitespace-nowrap',
                isPast && 'text-muted-foreground',
                isCurrent && 'font-semibold text-foreground',
                isFuture && 'text-muted-foreground/50',
              )}
            >
              {label}
            </span>
            {phase.key === 'submitted' && isPast && (
              <TimestampDot iso={createdAt} className="text-[10px]" />
            )}
            {idx < PHASES.length - 1 && <span aria-hidden className="h-px w-4 bg-border ml-1" />}
          </li>
        );
      })}
    </ol>
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

interface StreamViewProps {
  stream: ConversationStream;
  isMock: boolean;
  optimistic: OptimisticItem[];
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  /** Disable ask-user reply input — set when the run is done or mock. */
  askDisabled: boolean;
}

type DisplayItem =
  | { kind: 'stream'; key: string; receivedAt: string; item: StreamItem }
  | { kind: 'optimistic'; key: string; receivedAt: string; item: OptimisticItem };

function StreamView({
  stream,
  isMock,
  optimistic,
  answeredAskIds,
  onAnswerAsk,
  askDisabled,
}: StreamViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge live + optimistic items by timestamp so user-sent messages
  // appear in-flow as soon as they're sent, before any agent echo.
  const merged = useMemo<DisplayItem[]>(() => {
    const all: DisplayItem[] = [
      ...stream.items.map(
        (item): DisplayItem => ({
          kind: 'stream',
          key: `s-${item.id}`,
          receivedAt: item.receivedAt,
          item,
        }),
      ),
      ...optimistic.map(
        (item): DisplayItem => ({
          kind: 'optimistic',
          key: `o-${item.id}`,
          receivedAt: item.receivedAt,
          item,
        }),
      ),
    ];
    return all.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }, [stream.items, optimistic]);

  // Pin scroll to the bottom whenever new items arrive so live updates
  // stay in view without the user having to scroll.
  const count = merged.length;
  useEffect(() => {
    if (count === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [count]);

  if (merged.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-6 text-center text-xs text-muted-foreground"
      >
        {isMock ? 'Mock mode — no live stream.' : 'Waiting for the agent to start…'}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="space-y-2">
      {merged.map((d) =>
        d.kind === 'stream' ? (
          <StreamRow
            key={d.key}
            item={d.item}
            answeredAskIds={answeredAskIds}
            onAnswerAsk={onAnswerAsk}
            askDisabled={askDisabled}
          />
        ) : (
          <OptimisticRow key={d.key} item={d.item} />
        ),
      )}
    </div>
  );
}

function OptimisticRow({ item }: { item: OptimisticItem }) {
  // Both kinds render as "you said this" — keeps the transcript honest
  // about who spoke without forcing the user to wait for the agent to
  // echo their message back over the bus.
  return (
    <RowFrame speaker={item.kind === 'ask_response' ? 'You (answer)' : 'You'} at={item.receivedAt}>
      <p className="text-foreground whitespace-pre-wrap break-words">
        {item.kind === 'user_message' ? item.content : item.answer}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <Check className="h-3 w-3" />
        Sent · waiting for the agent to reply.
      </p>
    </RowFrame>
  );
}

interface StreamRowProps {
  item: StreamItem;
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  askDisabled: boolean;
}

function StreamRow({ item, answeredAskIds, onAnswerAsk, askDisabled }: StreamRowProps) {
  if (item.kind === 'error') {
    return (
      <div className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
        {item.message}
      </div>
    );
  }
  return (
    <EventRow
      event={item.event}
      at={item.receivedAt}
      answeredAskIds={answeredAskIds}
      onAnswerAsk={onAnswerAsk}
      disabled={askDisabled}
    />
  );
}

interface EventRowProps {
  event: AgentEvent;
  at: string;
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  disabled: boolean;
}

function EventRow({ event, at, answeredAskIds, onAnswerAsk, disabled }: EventRowProps) {
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
          <AskUserReply
            askId={event.askId}
            options={event.options}
            answered={answeredAskIds.has(event.askId)}
            disabled={disabled}
            onAnswer={(answer) => onAnswerAsk(event.askId, answer)}
          />
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

interface AskUserReplyProps {
  askId: string;
  options?: string[];
  answered: boolean;
  disabled: boolean;
  onAnswer: (answer: string) => void;
}

/**
 * Inline reply form for an `ask_user` event. Renders a quick-pick row
 * when the agent supplies `options`, otherwise a small textarea. Once
 * answered, the form collapses to a confirmation so the user can scroll
 * back and see what they replied without losing the question context.
 */
function AskUserReply({ askId, options, answered, disabled, onAnswer }: AskUserReplyProps) {
  const [draft, setDraft] = useState('');

  if (answered) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground italic">
        Reply sent · the agent will continue on its next turn.
      </p>
    );
  }

  if (options && options.length > 0) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Button
            key={`${askId}-${opt}`}
            size="sm"
            variant="outline"
            disabled={disabled}
            className="h-7 text-xs"
            onClick={() => onAnswer(opt)}
          >
            {opt}
          </Button>
        ))}
      </div>
    );
  }

  const submit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
    setDraft('');
  };

  return (
    <div className="mt-2 space-y-1.5">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Answer the agent…"
        disabled={disabled}
        className="min-h-[48px] resize-y text-xs bg-card/70"
      />
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={disabled || !draft.trim()}
          onClick={submit}
        >
          Answer
        </Button>
      </div>
    </div>
  );
}

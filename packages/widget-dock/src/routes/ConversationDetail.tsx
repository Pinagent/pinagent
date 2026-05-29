// SPDX-License-Identifier: Apache-2.0

import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pinagent/ui/components/ui/dropdown-menu';
import { Input } from '@pinagent/ui/components/ui/input';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ClipboardCopy,
  GitPullRequest,
  Pencil,
  Send,
  Terminal,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnchorChip } from '../components/AnchorChip';
import { AnchorContext } from '../components/AnchorContext';
import { CostChip } from '../components/CostChip';
import { TimestampDot } from '../components/TimestampDot';
import { useConversation } from '../hooks/useConversation';
import { useConversationStream } from '../hooks/useConversationStream';
import { useSettings } from '../hooks/useSettings';
import { useUpdateConversation } from '../hooks/useUpdateConversation';
import { permissionModeDisplay } from '../lib/permissionMode';
import { copyClaudeCommand, openInClaudeCode } from '../lib/vscode-bridge';
import { ROUTE_PATHS } from '../route-paths';
import { useExtensionLaunch } from '../shell/ExtensionLaunch';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { type ConversationDetail, useTransport, type WorktreeStatePayload } from '../transport';
import { type OptimisticItem, StreamView } from './ConversationStream';
import {
  LIFECYCLE_TIMEOUT_MS,
  type LifecycleError,
  type LifecycleIntent,
  lifecycleTimeoutState,
  reduceLifecycleOnWorktreeState,
} from './conversation-lifecycle';
import { deriveEffectiveStatus } from './conversation-status';

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
export function ConversationDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const transport = useTransport();
  const navigate = useNavigate();
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

  // Pending Stop click — keeps the button in "Stopping…" until the
  // turn actually ends (or until the user navigates away). We clear it
  // on turn-end via a `useEffect` below rather than racing the button
  // disappearing on the same tick that `turnRunning` flips.
  const [stopPending, setStopPending] = useState(false);
  useEffect(() => {
    if (!stream.turnRunning) setStopPending(false);
  }, [stream.turnRunning]);
  const performStop = (): void => {
    setStopPending(true);
    transport.sendInterrupt(id);
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
  // The Stop button is the only control surfaced for inline-mode runs
  // (no worktree → no Land/Discard), so include it in the action-row
  // gate. Visible whenever an agent turn is in flight, on top of the
  // existing land/discard/reopen controls.
  const canStop = stream.turnRunning;
  const showActionRow =
    canLand || canDiscard || canReopen || canStop || showLifecycleBusy || lifecycleError !== null;

  // The server's `status` field only flips on a terminal `resolve_feedback`
  // call — it doesn't track "agent started working" or "ask_user paused".
  // The live event stream does, so we override the cached status from
  // stream activity to keep the timeline + header badge honest.
  const effectiveStatus = deriveEffectiveStatus(
    detail.status,
    stream.items,
    answeredAskIds,
    stream.worktree,
  );

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
          apiKeySource={detail.apiKeySource}
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
            {canStop && stream.liveTurn > 0 && (
              <span className="text-[11px] text-muted-foreground font-mono">
                {stream.liveTurn} turn{stream.liveTurn === 1 ? '' : 's'}
              </span>
            )}
            {canStop && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={stopPending || isMock}
                onClick={performStop}
              >
                {stopPending ? 'Stopping…' : 'Stop'}
              </Button>
            )}
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
                  className="h-7 gap-1.5 text-xs"
                  disabled={!canLand || showLifecycleBusy}
                  onClick={() => void navigate({ to: ROUTE_PATHS.prsNew, search: { ids: id } })}
                  title="Open a PR for this conversation"
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                  Create PR
                </Button>
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
  const { attemptLaunch } = useExtensionLaunch();
  const settingsQuery = useSettings();
  const capUsd = settingsQuery.data?.perConversationCapUsd;
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
    attemptLaunch(() => openInClaudeCode(detail.comment));
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
        <AnchorContext anchor={detail.anchor} />
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
        {detail.totalCostUsd > 0 && (
          <CostChip
            cost={detail.totalCostUsd}
            cap={capUsd}
            size="md"
            apiKeySource={detail.apiKeySource}
          />
        )}
      </div>
    </div>
  );
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

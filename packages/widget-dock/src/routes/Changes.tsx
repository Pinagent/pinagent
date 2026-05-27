// SPDX-License-Identifier: Apache-2.0

import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  RotateCcw,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DiffView } from '../components/DiffView';
import { TimestampDot } from '../components/TimestampDot';
import type { Change } from '../fixtures';
import { useChangeDiff } from '../hooks/useChangeDiff';
import { useChanges } from '../hooks/useChanges';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';
import { Composer } from './Composer';

export function Changes() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [composing, setComposing] = useState(false);
  const transport = useTransport();
  const changesQuery = useChanges();

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ready = useMemo<Change[]>(
    () => (changesQuery.data ?? []).filter((c) => c.status === 'readyToLand'),
    [changesQuery.data],
  );
  const others = useMemo<Change[]>(
    () => (changesQuery.data ?? []).filter((c) => c.status !== 'readyToLand'),
    [changesQuery.data],
  );

  const isMock = transport.kind === 'mock';

  // When composing, resolve the selection against the latest changes
  // list — the user may have dropped one between selecting and clicking
  // "Create PR" (e.g., it auto-landed). Stale ids just no-op.
  const selectedChanges = useMemo(() => {
    if (!composing) return [];
    const byId = new Map(ready.map((c) => [c.id, c] as const));
    return [...selected].map((id) => byId.get(id)).filter((c): c is Change => c !== undefined);
  }, [composing, selected, ready]);

  if (composing && selectedChanges.length > 0) {
    return (
      <Composer
        selected={selectedChanges}
        onCancel={() => setComposing(false)}
        onSuccess={() => {
          // Conversations included in the PR are marked landed server-side
          // and will fall out of the next changes refetch. Drop them from
          // the selection so a re-enter doesn't try to compose them again.
          setSelected((prev) => {
            const next = new Set(prev);
            for (const c of selectedChanges) next.delete(c.id);
            return next;
          });
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Changes</h2>
        <span className="text-[11px] text-muted-foreground">
          {ready.length} ready · {others.length} other
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {selected.size > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {selected.size} selected
            </span>
          )}
          <Button
            size="sm"
            disabled={selected.size === 0}
            className="h-7 gap-1.5"
            variant={selected.size > 0 ? 'accent' : 'outline'}
            onClick={() => setComposing(true)}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            Create PR
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {changesQuery.isLoading && <LoadingState rows={4} />}

        {changesQuery.isError && (
          <ErrorState
            title="Couldn't load changes"
            description={
              <>
                The dock couldn't reach the local pinagent dev-server. Make sure your host app is
                running with the pinagent plugin, or append{' '}
                <code className="font-mono">?fixtures=on</code> to use the demo dataset.
              </>
            }
            onRetry={() => changesQuery.refetch()}
          />
        )}

        {changesQuery.isSuccess && ready.length === 0 && others.length === 0 && (
          <EmptyState
            title="No pending changes"
            description={
              isMock
                ? '(Mock mode — switch off ?fixtures=on for real data.)'
                : 'Conversations with an active worktree will appear here once the agent commits changes.'
            }
          />
        )}

        {ready.length > 0 && (
          <>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-1">
              Ready to land
            </div>
            {ready.map((c) => (
              <ReadyChangeRow
                key={c.id}
                change={c}
                selected={selected.has(c.id)}
                onToggle={() => toggle(c.id)}
                onLand={() => transport.landConversation(c.conversationId)}
                onDiscard={() => transport.discardConversation(c.conversationId)}
              />
            ))}
          </>
        )}

        {others.length > 0 && (
          <>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-3">
              Not ready
            </div>
            {others.map((c) => (
              <OtherChangeRow
                key={c.id}
                change={c}
                onDiscard={() => transport.discardConversation(c.conversationId)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ReadyChangeRow({
  change,
  selected,
  onToggle,
  onLand,
  onDiscard,
}: {
  change: Change;
  selected: boolean;
  onToggle: () => void;
  onLand: () => void;
  onDiscard: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const diffQuery = useChangeDiff(change.conversationId, { enabled: expanded });

  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-card p-3',
        'transition-colors',
        selected && 'border-foreground/40 bg-secondary/60',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${change.conversationTitle}`}
          className={cn(
            'mt-1 h-3.5 w-3.5 shrink-0 rounded border-border',
            'accent-foreground cursor-pointer',
          )}
        />
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'group flex w-full items-start gap-1.5 text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded',
            )}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            ) : (
              <ChevronRight
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
                aria-hidden
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                <h3 className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
                  {change.conversationTitle}
                </h3>
                <TimestampDot iso={change.updatedAt} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <StatusBadge status={change.status} variant="dot" />
                <span>
                  {change.filesChanged} file{change.filesChanged === 1 ? '' : 's'}
                </span>
                <span className="text-status-ready-fg">+{change.additions}</span>
                <span className="text-status-error-fg">−{change.deletions}</span>
                {change.branch && (
                  <span className="truncate font-mono text-[10.5px]">{change.branch}</span>
                )}
                {change.externallyModified && (
                  <span
                    role="status"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
                      'text-[10px] font-medium',
                      'text-status-error-fg bg-status-error-bg border border-status-error-border',
                    )}
                    title="The worktree's branch has commits the agent didn't make — someone reached in and committed manually. Review the diff before landing."
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    modified externally
                  </span>
                )}
              </div>
            </div>
          </button>

          {expanded && (
            <div className="mt-2.5">
              {diffQuery.isLoading && (
                <p className="text-[11px] text-muted-foreground italic">Loading diff…</p>
              )}
              {diffQuery.isError && (
                <p className="text-[11px] text-status-error-fg">
                  Couldn't load diff — {String(diffQuery.error)}
                </p>
              )}
              {diffQuery.isSuccess && diffQuery.data && (
                <DiffView diff={diffQuery.data.diff} truncated={diffQuery.data.truncated} />
              )}
              {diffQuery.isSuccess && !diffQuery.data && (
                <p className="text-[11px] text-muted-foreground italic">
                  Diff no longer available — worktree may have landed or been discarded.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onLand}>
            Land
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onDiscard}
            title="Discard"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function OtherChangeRow({ change, onDiscard }: { change: Change; onDiscard: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5">
      <StatusBadge status={change.status} variant="dot" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{change.conversationTitle}</p>
        {change.preview && (
          <p className="text-[11px] text-muted-foreground truncate">{change.preview}</p>
        )}
      </div>
      <TimestampDot iso={change.updatedAt} />
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDiscard} title="Discard">
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

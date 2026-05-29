// SPDX-License-Identifier: Apache-2.0
/**
 * `/prs/new` — the dock's single PR-composition surface. Reached from
 * the PRs tab's "New PR" button (cold, nothing pre-checked) and from the
 * Changes multi-select ("Create PR" → `?ids=a,b,c`, those pre-checked).
 *
 * Two phases:
 *   1. Picker — a checklist of ready-to-land conversations. The user
 *      chooses which to bundle; `?ids=` seeds the initial check state.
 *   2. Compose — the existing <Composer/> form, handed the picked set.
 *
 * Keeping the picker distinct preserves Composer's mount-time suggestion
 * logic (branch/title/description are derived from the final selection).
 */

import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, GitPullRequest } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TimestampDot } from '../components/TimestampDot';
import type { Change } from '../fixtures';
import { useChanges } from '../hooks/useChanges';
import { ROUTE_PATHS } from '../route-paths';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';
import { Composer } from './Composer';
import { parseComposeIds } from './compose-search';

export function NewPullRequest() {
  const navigate = useNavigate();
  const transport = useTransport();
  const isMock = transport.kind === 'mock';
  const search = useSearch({ from: ROUTE_PATHS.prsNew });
  const changesQuery = useChanges();

  const goToPrs = () => void navigate({ to: ROUTE_PATHS.prs });

  const ready = useMemo<Change[]>(
    () => (changesQuery.data ?? []).filter((c) => c.status === 'readyToLand'),
    [changesQuery.data],
  );

  // Seed the check state from `?ids=` once. Keyed on conversationId —
  // the identity both the Changes multi-select and the conversation
  // detail view emit, and what Composer ultimately submits. Stale ids
  // (no longer ready) simply don't match any row, so they drop silently.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(parseComposeIds(search)));
  // Snapshot of the conversations taken when the user hits "Continue".
  // Held independently of `picked` so clearing the selection on success
  // doesn't yank the Composer's success screen out from under the user.
  const [composing, setComposing] = useState<Change[] | null>(null);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Resolve the picked ids against the latest ready list — the same
  // staleness guard the Changes view used (a conversation may have
  // auto-landed between selection and "Continue"). Order follows the list.
  const pickedChanges = useMemo(
    () => ready.filter((c) => picked.has(c.conversationId)),
    [ready, picked],
  );

  if (composing) {
    return (
      <Composer
        selected={composing}
        onCancel={() => setComposing(null)}
        // The bundled conversations are marked landed server-side and fall
        // out of the next changes refetch; clear them from the picker too.
        onSuccess={() => setPicked(new Set())}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPrs}
          className="h-7 -ml-1.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to PRs
        </Button>
        <h2 className="ml-2 text-sm font-semibold tracking-tight">New pull request</h2>
        <span className="text-[11px] text-muted-foreground">Choose conversations to bundle</span>
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

        {changesQuery.isSuccess && ready.length === 0 && (
          <EmptyState
            Icon={GitPullRequest}
            title="Nothing ready to land"
            description={
              isMock
                ? '(Mock mode — switch off ?fixtures=on for real data.)'
                : 'Conversations whose worktree has committed changes show up here once they’re ready to land. Resolve a conversation first, then come back to open a PR.'
            }
          />
        )}

        {ready.length > 0 &&
          ready.map((c) => (
            <PickerRow
              key={c.id}
              change={c}
              checked={picked.has(c.conversationId)}
              onToggle={() => toggle(c.conversationId)}
            />
          ))}
      </div>

      <div className="border-t border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {picked.size} selected
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={goToPrs}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="accent"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setComposing(pickedChanges)}
            disabled={pickedChanges.length === 0}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

function PickerRow({
  change,
  checked,
  onToggle,
}: {
  change: Change;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer',
        'transition-colors',
        checked ? 'border-foreground/40 bg-secondary/60' : 'hover:bg-secondary/40',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className={cn(
          'mt-1 h-3.5 w-3.5 shrink-0 rounded border-border',
          'accent-foreground cursor-pointer',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
            {change.conversationTitle}
          </h3>
          <TimestampDot iso={change.updatedAt} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {change.filesChanged} file{change.filesChanged === 1 ? '' : 's'}
          </span>
          <span className="text-status-ready-fg">+{change.additions}</span>
          <span className="text-status-error-fg">−{change.deletions}</span>
          {change.branch && (
            <span className="truncate font-mono text-[10.5px]">{change.branch}</span>
          )}
        </div>
      </div>
    </label>
  );
}

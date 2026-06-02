// SPDX-License-Identifier: Apache-2.0

import type { WorkingCopyFile, WorkingCopyStatus } from '@pinagent/shared';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpFromLine, ExternalLink, GitBranch, GitPullRequest, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActivityRow } from '../components/ActivityRow';
import { useAuditLog } from '../hooks/useAuditLog';
import { useChanges } from '../hooks/useChanges';
import { useExtensionStatus } from '../hooks/useExtensionStatus';
import {
  useCreateWorkingCopyPr,
  usePushWorkingCopyBranch,
  useStartWorkingCopyBranch,
  useWorkingCopy,
} from '../hooks/useWorkingCopy';
import { openFileInVSCode, openSourceControl } from '../lib/vscode-bridge';
import { ROUTE_PATHS } from '../route-paths';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { deriveWorkingCopyAction, type WorkingCopyAction } from '../shell/working-copy-action';
import { useTransport } from '../transport';

function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 px-3 pt-4 pb-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {hint && <span className="text-[11px] text-muted-foreground/70 font-mono">{hint}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

const FILE_STATUS_META: Record<WorkingCopyFile['status'], { label: string; className: string }> = {
  added: { label: 'A', className: 'text-status-ready-fg' },
  deleted: { label: 'D', className: 'text-status-error-fg' },
  renamed: { label: 'R', className: 'text-muted-foreground' },
  modified: { label: 'M', className: 'text-amber-500' },
};

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function Overview() {
  const transport = useTransport();
  const navigate = useNavigate();
  const isMock = transport.kind === 'mock';
  const workingCopy = useWorkingCopy();
  // Agent worktrees still get a compact roll-up below the hero; the full
  // per-conversation view lives on the Changes route.
  const changes = useChanges();
  const activity = useAuditLog({ limit: 5 });

  const activeChanges = (changes.data ?? []).filter(
    (c) => c.status === 'readyToLand' || c.status === 'pending',
  );

  return (
    <div className="flex flex-1 flex-col">
      <SectionHeader title="Your changes" hint={isMock ? 'fixtures' : undefined} />

      <div className="px-3">
        {workingCopy.isLoading && <LoadingState rows={3} />}
        {workingCopy.isError && (
          <ErrorState
            title="Couldn't load git status"
            description={
              <>
                The dock couldn't reach the local pinagent dev-server. Make sure your host app is
                running with the pinagent plugin, or append{' '}
                <code className="font-mono">?fixtures=on</code> to use the demo dataset.
              </>
            }
            onRetry={() => workingCopy.refetch()}
          />
        )}
        {workingCopy.isSuccess && <WorkingCopyCard status={workingCopy.data} />}
      </div>

      <SectionHeader
        title="Agent worktrees"
        action={
          activeChanges.length > 0 ? (
            <button
              type="button"
              onClick={() => navigate({ to: ROUTE_PATHS.changes })}
              className="text-[11px] text-accent hover:underline"
            >
              View all
            </button>
          ) : undefined
        }
      />
      <div className="px-3">
        {activeChanges.length === 0 ? (
          <EmptyState
            title="No agent worktrees"
            description="Conversations with an active worktree appear here once an agent commits changes."
          />
        ) : (
          <AgentWorktreesSummary count={activeChanges.length} />
        )}
      </div>

      <SectionHeader title="Recent activity" hint={isMock ? 'fixtures' : undefined} />
      {activity.isLoading ? (
        <LoadingState rows={2} />
      ) : (activity.data ?? []).length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Conversations created, landed, and discarded — plus PRs you open — appear here."
        />
      ) : (
        <ol className="flex flex-col gap-1 px-3 pb-4">
          {(activity.data ?? []).map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </ol>
      )}

      <div className="mt-auto border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {isMock
            ? 'Fixtures · drop ?fixtures=on to read from a local pinagent dev-server.'
            : 'Live · refreshes on project events.'}
        </p>
      </div>
    </div>
  );
}

function AgentWorktreesSummary({ count }: { count: number }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate({ to: ROUTE_PATHS.changes })}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left',
        'hover:bg-secondary/50 transition-colors',
      )}
    >
      <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="text-sm">
        {count} agent worktree{count === 1 ? '' : 's'} with changes
      </span>
      <span className="ml-auto text-[11px] text-accent">Review →</span>
    </button>
  );
}

function WorkingCopyCard({ status }: { status: WorkingCopyStatus }) {
  const ext = useExtensionStatus();
  const createPr = useCreateWorkingCopyPr();
  const pushBranch = usePushWorkingCopyBranch();
  const startBranch = useStartWorkingCopyBranch();
  const action = deriveWorkingCopyAction(status);
  const editorReady = ext.present;

  // Surface the latest mutation outcome (whichever ran). The PR shape is
  // shared between create + push (prUrl / manualCompareUrl / error);
  // start-a-branch only surfaces an error here (success flips the hero).
  const result = createPr.data ?? pushBranch.data ?? startBranch.data;
  const mutating = createPr.isPending || pushBranch.isPending || startBranch.isPending;

  // On Create PR, open the freshly-opened PR (or the compare page when no PR
  // could be created) in the browser — then the refetched status flips the
  // button to "View PR".
  const handleCreate = async () => {
    try {
      const res = await createPr.mutateAsync();
      const url = res.prUrl ?? res.manualCompareUrl;
      if (url) openExternal(url);
    } catch {
      // Error surfaces via the result banner; nothing to open.
    }
  };

  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-mono text-sm font-medium" title={status.branch}>
          {status.branch}
        </span>
        <span className="text-[11px] text-muted-foreground">→ {status.baseBranch}</span>
        {status.hasUpstream && status.ahead > 0 && (
          <span className="text-[10.5px] font-medium text-amber-500" title="commits not yet pushed">
            ↑{status.ahead}
          </span>
        )}
        {status.behind > 0 && (
          <span className="text-[10.5px] text-muted-foreground" title="commits behind the remote">
            ↓{status.behind}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {status.filesChanged} file{status.filesChanged === 1 ? '' : 's'}
        </span>
        <span className="text-status-ready-fg">+{status.additions}</span>
        <span className="text-status-error-fg">−{status.deletions}</span>
        {status.dirty && (
          <span className="text-amber-500" title="uncommitted changes in the working tree">
            • uncommitted
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <PrimaryAction
          action={action}
          mutating={mutating}
          onCreate={handleCreate}
          onPush={() => pushBranch.mutate()}
          onStart={() => startBranch.mutate(undefined)}
        />
        {editorReady && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            onClick={() => openSourceControl()}
            title="Open the Source Control view in VSCode"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in VSCode
          </Button>
        )}
      </div>

      {result && <ResultBanner result={result} />}

      {status.files.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5 border-t border-border pt-2">
          {status.files.map((f) => (
            <FileRow key={f.path} file={f} editorReady={editorReady} />
          ))}
        </ul>
      )}
      {!editorReady && ext.known && status.files.length > 0 && (
        <p className="mt-2 text-[10.5px] text-muted-foreground/70">
          Install the Pinagent VSCode extension to open files from here.
        </p>
      )}
    </article>
  );
}

function PrimaryAction({
  action,
  mutating,
  onCreate,
  onPush,
  onStart,
}: {
  action: WorkingCopyAction;
  mutating: boolean;
  onCreate: () => void;
  onPush: () => void;
  onStart: () => void;
}) {
  if (action.kind === 'view') {
    return (
      <Button
        size="sm"
        variant="accent"
        className="h-7 gap-1.5"
        onClick={() => action.href && openExternal(action.href)}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {action.label}
      </Button>
    );
  }
  if (action.kind === 'disabled') {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5"
        disabled
        title={action.disabledReason}
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        {action.disabledReason ? `${action.label} · ${action.disabledReason}` : action.label}
      </Button>
    );
  }
  if (action.kind === 'start') {
    return (
      <Button
        size="sm"
        variant="accent"
        className="h-7 gap-1.5"
        disabled={mutating}
        onClick={onStart}
      >
        {mutating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitBranch className="h-3.5 w-3.5" />
        )}
        {mutating ? 'Starting branch…' : action.label}
      </Button>
    );
  }
  const isPush = action.kind === 'push';
  return (
    <Button
      size="sm"
      variant="accent"
      className="h-7 gap-1.5"
      disabled={mutating}
      onClick={() => (isPush ? onPush() : onCreate())}
    >
      {mutating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isPush ? (
        <ArrowUpFromLine className="h-3.5 w-3.5" />
      ) : (
        <GitPullRequest className="h-3.5 w-3.5" />
      )}
      {mutating ? (isPush ? 'Pushing…' : 'Creating PR…') : action.label}
    </Button>
  );
}

function ResultBanner({
  result,
}: {
  result: { ok: boolean; prUrl?: string; manualCompareUrl?: string; error?: string };
}) {
  if (result.prUrl) {
    return (
      <button
        type="button"
        onClick={() => result.prUrl && openExternal(result.prUrl)}
        className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-status-ready-border bg-status-ready-bg px-2 py-1.5 text-left text-[11px] text-status-ready-fg hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        PR opened — view on GitHub
      </button>
    );
  }
  if (result.manualCompareUrl) {
    return (
      <button
        type="button"
        onClick={() => result.manualCompareUrl && openExternal(result.manualCompareUrl)}
        className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        Branch pushed — open the PR on GitHub
      </button>
    );
  }
  if (result.error) {
    return (
      <p className="mt-2 rounded-md border border-status-error-border bg-status-error-bg px-2 py-1.5 text-[11px] text-status-error-fg">
        {result.error}
      </p>
    );
  }
  return null;
}

function FileRow({ file, editorReady }: { file: WorkingCopyFile; editorReady: boolean }) {
  const meta = FILE_STATUS_META[file.status];
  const inner = (
    <>
      <span
        className={cn('w-3 shrink-0 text-center font-mono text-[10px] font-bold', meta.className)}
      >
        {meta.label}
      </span>
      <span className="flex-1 truncate font-mono text-[11px]" title={file.path}>
        {file.path}
      </span>
      {file.added > 0 && <span className="text-[10.5px] text-status-ready-fg">+{file.added}</span>}
      {file.deleted > 0 && (
        <span className="text-[10.5px] text-status-error-fg">−{file.deleted}</span>
      )}
    </>
  );
  if (editorReady) {
    return (
      <li>
        <button
          type="button"
          onClick={() => openFileInVSCode(file.path)}
          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-secondary/50"
          title="Open in VSCode"
        >
          {inner}
        </button>
      </li>
    );
  }
  return <li className="flex items-center gap-2 px-1 py-0.5">{inner}</li>;
}

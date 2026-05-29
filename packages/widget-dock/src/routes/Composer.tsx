// SPDX-License-Identifier: Apache-2.0
/**
 * PR composer form. The compose phase of the `/prs/new` route
 * (`NewPullRequest`): once the user has picked conversations, this
 * pre-fills the branch name, PR title, and description from that
 * selection, lets them reorder the conversations and edit each field,
 * and submits to `transport.createPullRequest`.
 *
 * Presentational + selection-agnostic: it takes the picked `Change[]`
 * and `onCancel` / `onSuccess` callbacks, so the route owns navigation
 * (back to the picker, forward to the PRs list).
 */

import { Button } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { cn } from '@pinagent/ui/lib/utils';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ExternalLink,
  GitPullRequest,
} from 'lucide-react';
import { useState } from 'react';
import type { Change } from '../fixtures';
import { useGitBranches } from '../hooks/useGitBranches';
import { useSettings } from '../hooks/useSettings';
import {
  type CreatePullRequestInput,
  type CreatePullRequestResult,
  useTransport,
} from '../transport';

export interface ComposerProps {
  /** The conversations the user picked to bundle into this PR. */
  selected: Change[];
  /** Return to the picker (back out of the compose phase). */
  onCancel: () => void;
  /** Called when the PR is successfully created so the parent can navigate on. */
  onSuccess: (result: CreatePullRequestResult) => void;
}

/**
 * Initial branch name suggestion. Spec: `pinagent/<short-hash>` —
 * derived deterministically from the selection so re-entering the
 * composer with the same selection gives the same branch.
 */
function suggestBranchName(selected: Change[]): string {
  const ids = selected
    .map((c) => c.conversationId)
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < ids.length; i++) {
    hash = (hash * 33 + ids.charCodeAt(i)) >>> 0;
  }
  return `pinagent/batch-${hash.toString(36).slice(0, 6)}`;
}

function suggestTitle(selected: Change[]): string {
  if (selected.length === 1) return selected[0]!.conversationTitle;
  return `pinagent: ${selected.length} conversations`;
}

function suggestDescription(selected: Change[]): string {
  const lines = ['## Conversations in this PR', ''];
  selected.forEach((c, i) => {
    lines.push(`${i + 1}. **${c.conversationTitle}** — \`${c.branch}\``);
  });
  lines.push('', '_Composed via pinagent dock._');
  return lines.join('\n');
}

export function Composer({ selected, onCancel, onSuccess }: ComposerProps) {
  const transport = useTransport();
  const isMock = transport.kind === 'mock';

  // Default the base branch to the project's configured branch rather
  // than assuming `main`. `baseOverride` holds the user's edit (if any);
  // until then we track the setting, falling back to `main` while it
  // loads or on a project that hasn't set one.
  const settingsQuery = useSettings();
  const defaultBaseBranch = settingsQuery.data?.baseBranch ?? 'main';
  const [baseOverride, setBaseOverride] = useState<string | null>(null);
  const baseBranch = baseOverride ?? defaultBaseBranch;

  // Suggest the repo's real branches in the base-branch field. Stays a
  // free-text input (you can target a branch git doesn't know yet); the
  // datalist just turns the common case into a pick.
  const gitBranchesQuery = useGitBranches();
  const branchOptions = gitBranchesQuery.data ?? [];

  const [order, setOrder] = useState<Change[]>(selected);
  const [branchName, setBranchName] = useState(() => suggestBranchName(selected));
  const [title, setTitle] = useState(() => suggestTitle(selected));
  const [description, setDescription] = useState(() => suggestDescription(selected));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatePullRequestResult | null>(null);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);

  const move = (idx: number, dir: -1 | 1): void => {
    setOrder((prev) => {
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next]!, copy[idx]!];
      return copy;
    });
  };

  const canSubmit =
    !submitting && order.length > 0 && branchName.trim().length > 0 && title.trim().length > 0;

  const submit = async (): Promise<void> => {
    setUnexpectedError(null);
    setResult(null);
    setSubmitting(true);
    const input: CreatePullRequestInput = {
      feedbackIds: order.map((c) => c.conversationId),
      branchName: branchName.trim(),
      title: title.trim(),
      description,
      baseBranch: baseBranch.trim(),
    };
    try {
      const r = await transport.createPullRequest(input);
      setResult(r);
      if (r.ok) onSuccess(r);
    } catch (e) {
      setUnexpectedError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Once the PR is composed, swap the body for a success summary — the
  // user has nothing else to fill out and we don't want them re-clicking
  // Create PR on the same selection.
  if (result?.ok) {
    return <ComposerSuccess result={result} onBack={onCancel} />;
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 -ml-1.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <h2 className="ml-2 text-sm font-semibold tracking-tight">New pull request</h2>
        <span className="text-[11px] text-muted-foreground">
          {order.length} conversation{order.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        <Field label="Branch name" hint="Pushed to origin as this name.">
          <Input
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
        </Field>

        <Field label="Base branch" hint="Compose branch starts here; PR targets it.">
          <Input
            value={baseBranch}
            onChange={(e) => setBaseOverride(e.target.value)}
            spellCheck={false}
            list="pa-base-branches"
            className="h-8 max-w-[260px] font-mono text-xs"
          />
          {branchOptions.length > 0 && (
            <datalist id="pa-base-branches">
              {branchOptions.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          )}
        </Field>

        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" />
        </Field>

        <Field label="Description" hint="Markdown. Becomes the PR body.">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[120px] resize-y text-xs font-mono"
          />
        </Field>

        <section className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">
            Merge order
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">
              · top is merged first
            </span>
          </p>
          <ul className="rounded-lg border border-border bg-card divide-y divide-border">
            {order.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 px-2.5 py-2">
                <span className="w-4 text-center text-[10.5px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {c.conversationTitle}
                  </p>
                  <p className="text-[10.5px] text-muted-foreground font-mono truncate">
                    {c.branch} · +{c.additions} −{c.deletions}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  disabled={i === 0 || submitting}
                  onClick={() => move(i, -1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  disabled={i === order.length - 1 || submitting}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {result && !result.ok && <ComposerError result={result} />}
        {unexpectedError && (
          <div className="flex items-start gap-2 rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-snug">{unexpectedError}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {isMock
            ? 'Mock mode — submit returns a fake PR URL.'
            : 'Push uses your local git credentials; PR opens via the dev-server.'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="accent"
            className="h-7 gap-1.5 text-xs"
            onClick={submit}
            disabled={!canSubmit}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            {submitting ? 'Composing…' : 'Create PR'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // The input is rendered as `children`, and the label wraps it — this
  // is the implicit-association pattern. Biome's rule can't follow into
  // children to verify, hence the ignore.
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: input is nested in children
    <label className="block space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function ComposerError({ result }: { result: CreatePullRequestResult }) {
  return (
    <div className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 space-y-1 text-[12px] text-status-error-fg">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>
          {result.conflicts ? `Merge conflict in ${result.conflicts.feedbackId}` : 'Compose failed'}
        </span>
      </div>
      {result.error && <p className="leading-snug">{result.error}</p>}
      {result.conflicts && result.conflicts.files.length > 0 && (
        <ul className="mt-1 ml-2 font-mono text-[11px] space-y-0.5">
          {result.conflicts.files.map((f) => (
            <li key={f}>— {f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ComposerSuccess({
  result,
  onBack,
}: {
  result: CreatePullRequestResult;
  onBack: () => void;
}) {
  const hasUrl = Boolean(result.prUrl);
  const hasManual = Boolean(result.manualCompareUrl);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 -ml-1.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-md space-y-3 text-center">
          <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-status-ready-bg text-status-ready-fg">
            <Check className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-semibold">
            {hasUrl ? 'Pull request opened' : 'Branch pushed'}
          </h2>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            {hasUrl
              ? 'Pinagent landed the selected conversations on a fresh branch and opened the PR via the GitHub API.'
              : hasManual
                ? "The branch is on the remote. GitHub auth isn't connected yet, so the PR isn't opened — use the link below to open it manually."
                : "The branch is on the remote. The dev-server didn't recognize the origin as GitHub, so the PR can't be opened automatically."}
          </p>
          {result.error && <p className="text-[11px] text-status-awaiting-fg">{result.error}</p>}
          {(hasUrl || hasManual) && (
            <a
              href={result.prUrl ?? result.manualCompareUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
                'bg-accent text-accent-foreground hover:bg-accent/90 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {hasUrl ? 'Open PR on GitHub' : 'Open compare on GitHub'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

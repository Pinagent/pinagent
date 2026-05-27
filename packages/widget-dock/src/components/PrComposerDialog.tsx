// SPDX-License-Identifier: Apache-2.0
/**
 * PR composer dialog. Launched from the Changes view when the user
 * clicks "Create PR" with >0 changes selected. Form is pre-populated
 * from the selected conversations; the user can edit branch / base
 * branch / title / description before submitting.
 *
 * Three terminal states:
 *   - idle: form, Submit button enabled when title is non-empty
 *   - submitting: form disabled, spinner on Submit
 *   - done: success card with PR link, or error card with `.code`-
 *           specific guidance (set GITHUB_TOKEN, resolve conflicts, etc.)
 */
import { Button } from '@pinagent/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pinagent/ui/components/ui/dialog';
import { Input } from '@pinagent/ui/components/ui/input';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { CheckCircle2, ExternalLink, GitPullRequest, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Change } from '../fixtures/types';
import { type CreatePrResult, CreatePrTransportError, useTransport } from '../transport';

const DEFAULT_BASE_BRANCH = 'main';

export interface PrComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Changes currently selected on the Changes view. Order is preserved. */
  selected: Change[];
  /** Called when the PR is created so the parent can clear selection. */
  onSuccess?: (result: CreatePrResult) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; result: CreatePrResult }
  | { kind: 'error'; code: string; message: string; details: Record<string, unknown> | null };

export function PrComposerDialog({
  open,
  onOpenChange,
  selected,
  onSuccess,
}: PrComposerDialogProps) {
  const transport = useTransport();
  const isMock = transport.kind === 'mock';

  const defaultTitle = useMemo(() => suggestedTitle(selected), [selected]);
  const defaultBody = useMemo(() => suggestedBody(selected), [selected]);

  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(defaultBody);
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState(DEFAULT_BASE_BRANCH);
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Reset form whenever the dialog (re)opens with a new selection.
  // Keeps the suggested copy in sync with the user's current selection
  // and clears any prior success/error state from the last submission.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setBody(defaultBody);
      setBranchName('');
      setBaseBranch(DEFAULT_BASE_BRANCH);
      setState({ kind: 'idle' });
    }
  }, [open, defaultTitle, defaultBody]);

  const submitting = state.kind === 'submitting';
  const canSubmit = title.trim().length > 0 && selected.length > 0 && !submitting;

  const handleSubmit = async (): Promise<void> => {
    setState({ kind: 'submitting' });
    try {
      const result = await transport.createPr({
        conversationIds: selected.map((c) => c.conversationId),
        title: title.trim(),
        body: body.trim(),
        branchName: branchName.trim() || undefined,
        baseBranch: baseBranch.trim() || undefined,
      });
      setState({ kind: 'success', result });
      onSuccess?.(result);
    } catch (err) {
      if (err instanceof CreatePrTransportError) {
        setState({
          kind: 'error',
          code: err.code,
          message: err.message,
          details: err.details,
        });
      } else {
        setState({
          kind: 'error',
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
          details: null,
        });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            New pull request
          </DialogTitle>
          <DialogDescription>
            {selected.length} {selected.length === 1 ? 'conversation' : 'conversations'} · commits
            will be cherry-picked onto a fresh branch off{' '}
            <code className="font-mono">{baseBranch || DEFAULT_BASE_BRANCH}</code>.
          </DialogDescription>
        </DialogHeader>

        {state.kind === 'success' ? (
          <SuccessPanel result={state.result} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="space-y-3">
              <Field label="Title">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={submitting}
                  placeholder="What this PR does"
                  className="text-xs"
                />
              </Field>

              <Field label="Description">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={submitting}
                  rows={6}
                  className="text-xs resize-y font-mono"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Branch">
                  <Input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    disabled={submitting}
                    placeholder="pinagent/pr-<random>"
                    className="text-xs font-mono"
                  />
                </Field>
                <Field label="Base">
                  <Input
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    disabled={submitting}
                    placeholder={DEFAULT_BASE_BRANCH}
                    className="text-xs font-mono"
                  />
                </Field>
              </div>
            </div>

            {state.kind === 'error' && (
              <ErrorPanel code={state.code} message={state.message} details={state.details} />
            )}

            {isMock && (
              <p className="text-[11px] text-muted-foreground italic">
                Mock mode — submission returns a fake PR URL; no real branch is pushed.
              </p>
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="accent"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="text-xs gap-1.5"
              >
                {submitting ? (
                  <>
                    <Spinner /> Creating…
                  </>
                ) : (
                  <>
                    <GitPullRequest className="h-3.5 w-3.5" />
                    Create pull request
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  // Plain div + label-shaped span. The form is short and explicit; the
  // click-label-to-focus-input affordance would require threading an
  // ID through every Input/Textarea call site for what's effectively a
  // two-row form.
  return (
    <div className="space-y-1">
      <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3 w-3 inline-block rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none"
    />
  );
}

function SuccessPanel({ result, onClose }: { result: CreatePrResult; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-status-ready-border bg-status-ready-bg p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-status-ready-fg" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">PR #{result.number} opened</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Branch <code className="font-mono">{result.branch}</code> is pushed and the PR is live.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
          Close
        </Button>
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 h-8 px-3 text-xs font-medium transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open on GitHub
        </a>
      </div>
    </div>
  );
}

function ErrorPanel({
  code,
  message,
  details,
}: {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}) {
  return (
    <div className="rounded-md border border-status-error-border bg-status-error-bg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <TriangleAlert className="h-4 w-4 shrink-0 text-status-error-fg mt-0.5" />
        <div className="flex-1 min-w-0 text-[12px]">
          <p className="font-semibold text-status-error-fg">{titleForCode(code)}</p>
          <p className="text-foreground mt-0.5 break-words">{message}</p>
          {code === 'cherry-pick-conflict' && Array.isArray(details?.conflicts) && (
            <ul className="mt-1 list-disc pl-4 font-mono text-[11px] text-foreground/80">
              {(details.conflicts as string[]).slice(0, 8).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {(details.conflicts as string[]).length > 8 && (
                <li className="list-none text-muted-foreground italic">…and more</li>
              )}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">{hintForCode(code)}</p>
        </div>
      </div>
    </div>
  );
}

function titleForCode(code: string): string {
  switch (code) {
    case 'no-token':
      return 'GITHUB_TOKEN not set';
    case 'no-remote':
      return 'No `origin` remote';
    case 'unknown-remote':
      return 'Non-GitHub remote';
    case 'cherry-pick-conflict':
      return 'Cherry-pick conflict';
    case 'push-failed':
      return 'Push failed';
    case 'github-api-failed':
      return 'GitHub API rejected the PR';
    case 'no-conversations':
      return 'Nothing selected';
    case 'conversation-missing':
      return 'Conversation not found';
    case 'no-commits':
      return 'No commits ahead of base';
    default:
      return "Couldn't create the PR";
  }
}

function hintForCode(code: string): string {
  switch (code) {
    case 'no-token':
      return 'Export GITHUB_TOKEN on your dev-server process and try again.';
    case 'no-remote':
    case 'unknown-remote':
      return 'Add a GitHub `origin` remote: `git remote add origin git@github.com:<owner>/<repo>.git`.';
    case 'cherry-pick-conflict':
      return 'Land or discard the conflicting conversations individually, then try again.';
    case 'push-failed':
      return 'Check that your machine can push to the remote and the branch name isn’t taken.';
    case 'github-api-failed':
      return 'GitHub returned an error — usually permissions on the repo or branch protection.';
    case 'no-commits':
      return 'The selected conversations have no commits ahead of the base branch yet.';
    default:
      return 'See the dev-server log for details.';
  }
}

function suggestedTitle(selected: Change[]): string {
  if (selected.length === 0) return '';
  if (selected.length === 1) {
    return `pinagent: ${selected[0]!.conversationTitle}`;
  }
  return `pinagent: ${selected.length} changes`;
}

function suggestedBody(selected: Change[]): string {
  if (selected.length === 0) return '';
  const lines = ['Bundled by pinagent.', '', '## Changes', ''];
  for (const c of selected) {
    lines.push(`- ${c.conversationTitle} (\`${c.branch || '?'}\`)`);
  }
  lines.push('');
  lines.push('🤖 Composed via the pinagent dock.');
  return lines.join('\n');
}

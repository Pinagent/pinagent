// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hook for the dashboard's working-changes hero. Keyed on
 * transport.kind so mock ↔ local swaps don't serve stale cross-source
 * data; invalidated on `conversations_changed` project events (see
 * useProjectSubscription's CONVERSATIONS_CHANGED_KEYS) so agents landing
 * work re-derive the ahead/behind + file stats.
 */

import type { WorkingCopyStatus } from '@pinagent/shared';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useTransport } from '../transport';
import type { CreatePullRequestResult, StartBranchResult } from '../transport/types';

const KEY = 'workingCopy';

/**
 * How often to re-read the host branch's git status while the dashboard is
 * on screen. The endpoint just shells out to `git diff` (~ms), so a short
 * interval is cheap, and TanStack Query pauses it automatically when the
 * query has no mounted observer (dock on another route / closed) AND when
 * the tab is backgrounded (`refetchIntervalInBackground` defaults false).
 */
const POLL_MS = 5_000;

export function useWorkingCopy(): UseQueryResult<WorkingCopyStatus> {
  const transport = useTransport();
  return useQuery({
    queryKey: [KEY, transport.kind],
    queryFn: () => transport.getWorkingCopyStatus(),
    // Visibility-scoped polling keeps the hero fresh when the developer
    // edits or reverts files directly in their editor — those changes emit
    // no pinagent lifecycle event, so without this the hero would only
    // refresh on mount / window-focus (gated by the 60s global staleTime).
    //
    // Tradeoff vs a server-side fs watcher (chokidar/@parcel/watcher): a
    // watcher gives instant, focus-independent updates (and catches the
    // side-by-side case where the browser never blurs), but holds OS watch
    // handles on the whole tree for the entire session even when nobody's
    // looking. Polling does a little redundant work while the dashboard is
    // visible but costs nothing otherwise and needs no native dep — the
    // better fit for a lightweight localhost tool. Worst-case staleness is
    // one interval (~5s) while viewing.
    refetchInterval: POLL_MS,
  });
}

/**
 * Open a PR for the current host branch (server summarizes the diff +
 * pushes + opens via Octokit). On success the working-copy status changes
 * (a PR now exists, branch is pushed) and the compose flow may have
 * written a PRs row — invalidate both so the button flips to "View PR".
 */
export function useCreateWorkingCopyPr(): UseMutationResult<CreatePullRequestResult, Error, void> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.createWorkingCopyPr(),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [KEY, transport.kind] }),
        qc.invalidateQueries({ queryKey: ['pullRequests', transport.kind] }),
      ]);
    },
  });
}

/** Push the current host branch to its upstream (the "Push changes" action). */
export function usePushWorkingCopyBranch(): UseMutationResult<
  CreatePullRequestResult,
  Error,
  void
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.pushWorkingCopyBranch(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [KEY, transport.kind] });
    },
  });
}

/**
 * Move the working changes onto a fresh feature branch (the "Start a branch"
 * action on the base branch). On success the host branch changes, so the
 * hero re-derives and the primary button flips to "Create PR".
 */
export function useStartWorkingCopyBranch(): UseMutationResult<
  StartBranchResult,
  Error,
  string | undefined
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => transport.startWorkingCopyBranch(name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [KEY, transport.kind] });
    },
  });
}

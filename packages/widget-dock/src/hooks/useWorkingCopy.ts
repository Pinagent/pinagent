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
import type { CreatePullRequestResult } from '../transport/types';

const KEY = 'workingCopy';

export function useWorkingCopy(): UseQueryResult<WorkingCopyStatus> {
  const transport = useTransport();
  return useQuery({
    queryKey: [KEY, transport.kind],
    queryFn: () => transport.getWorkingCopyStatus(),
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

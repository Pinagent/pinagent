// SPDX-License-Identifier: Apache-2.0
/**
 * Read + prune hooks for the Branches view. The list query is keyed on
 * transport.kind so mock ↔ local swaps don't serve stale cross-source
 * data; the prune mutations invalidate the same key so a successful
 * prune drops the row without a manual refetch.
 */
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Branch } from '../fixtures/types';
import {
  type BulkPruneResult,
  type PruneStaleResult,
  type ServeBranchResult,
  useTransport,
  type WorktreeServer,
} from '../transport';

const KEY = ['branches'] as const;
const SERVERS_KEY = ['worktreeServers'] as const;

export function useBranches(): UseQueryResult<Branch[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: [...KEY, transport.kind],
    queryFn: () => transport.listBranches(),
  });
}

export function usePruneBranch(): UseMutationResult<void, Error, string> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackId: string) => transport.pruneBranch(feedbackId),
    // Server-side prune is also a discard, so the Conversations list
    // changes too — invalidate both caches so the dock stays consistent
    // across views.
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, transport.kind] }),
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
      ]);
    },
  });
}

/**
 * Stand up (or reuse) an on-demand dev server for one worktree. No cache
 * invalidation — serving doesn't change the branch list; the caller just
 * opens the returned URL in a new tab.
 */
export function useServeBranch(): UseMutationResult<ServeBranchResult, Error, string> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackId: string) => transport.serveBranch(feedbackId),
    // A successful start changes the running-server set — refresh the
    // switcher's list so the new server shows up without waiting for the
    // poll interval.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...SERVERS_KEY, transport.kind] });
    },
  });
}

/**
 * The on-demand worktree dev servers currently running. Polled so a
 * server started elsewhere (another dock, the Branches "Open app"
 * button) surfaces in the switcher; `useServeBranch` also invalidates
 * this key on success for an immediate update.
 */
export function useWorktreeServers(): UseQueryResult<WorktreeServer[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: [...SERVERS_KEY, transport.kind],
    queryFn: () => transport.listWorktreeServers(),
    refetchInterval: 4000,
  });
}

/**
 * Stop one worktree's dev server (frees its port). Invalidates the
 * server list so the switcher drops the row; the project subscription
 * also picks up the `worktree_servers_changed` event for live updates
 * from other dock instances.
 */
export function useStopWorktreeServer(): UseMutationResult<void, Error, string> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackId: string) => transport.stopWorktreeServer(feedbackId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...SERVERS_KEY, transport.kind] });
    },
  });
}

export function usePruneStaleBranches(): UseMutationResult<PruneStaleResult, Error, void> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.pruneStaleBranches(),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, transport.kind] }),
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
      ]);
    },
  });
}

/**
 * Bulk-prune a hand-picked batch of worktrees. Invalidates branches +
 * conversations + changes (each pruned row is also a worktree discard
 * that drops it from the Changes view) + auditLog (so the
 * History → Activity tab picks up the single bulk audit entry).
 */
export function useBulkPruneBranches(): UseMutationResult<BulkPruneResult, Error, string[]> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackIds: string[]) => transport.bulkPruneBranches(feedbackIds),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, transport.kind] }),
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
        qc.invalidateQueries({ queryKey: ['changes', transport.kind] }),
        qc.invalidateQueries({ queryKey: ['auditLog', transport.kind] }),
      ]);
    },
  });
}

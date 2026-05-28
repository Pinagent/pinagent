// SPDX-License-Identifier: Apache-2.0
/**
 * Mutation hook for `transport.bulkReopenConversations` — the History
 * view's multi-select uses this to re-open landed/discarded
 * conversations in one call.
 *
 * Invalidates the conversations list query so re-opened rows leave
 * the resolved section + appear in active. The audit log invalidation
 * picks up the single bulk audit row (`conversations_bulk_reopened`)
 * and the per-row `conversation_reopened` rows. The conversations
 * `conversations_changed` project events from each `Storage.patch`
 * during the per-row reopen fire too; TanStack Query coalesces them.
 */
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type BulkReopenResult, useTransport } from '../transport';

export function useBulkReopen(): UseMutationResult<BulkReopenResult, Error, string[]> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackIds: string[]) => transport.bulkReopenConversations(feedbackIds),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
        qc.invalidateQueries({ queryKey: ['auditLog', transport.kind] }),
      ]);
    },
  });
}

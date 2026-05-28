// SPDX-License-Identifier: Apache-2.0
/**
 * Mutation hook for `transport.updateConversation` — rename + archive
 * flows live behind this. Invalidates the conversations list query AND
 * the per-conversation detail query so the open detail view picks up
 * a new title or archived flag without a manual refetch.
 *
 * The real (local) transport also drives a `conversations_changed`
 * project event from the server side, which `useProjectSubscription`
 * would invalidate independently — the explicit invalidation here
 * covers the mock path (no WS) and removes an interleaved-refetch
 * race in the live path.
 */
import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { Conversation } from '../fixtures/types';
import { type ConversationUpdate, useTransport } from '../transport';

export interface UpdateConversationVariables {
  id: string;
  patch: ConversationUpdate;
}

/**
 * Invalidate every cache that could carry stale data after a rename or
 * archive mutation lands. Exported so the contract can be tested
 * directly without rendering React — the keys it invalidates have to
 * stay in lock-step with `useConversations` and `useConversation`'s
 * fetch keys, and there's no compiler check on that.
 */
export async function invalidateAfterUpdateConversation(
  qc: QueryClient,
  transportKind: string,
  conversationId: string,
): Promise<void> {
  await Promise.all([
    // 2-element prefix → matches every filter variant of the list query.
    qc.invalidateQueries({ queryKey: ['conversations', transportKind] }),
    // Exact 3-element key → only the open detail picks this up.
    qc.invalidateQueries({ queryKey: ['conversation', transportKind, conversationId] }),
  ]);
}

export function useUpdateConversation(): UseMutationResult<
  Conversation,
  Error,
  UpdateConversationVariables
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => transport.updateConversation(id, patch),
    onSuccess: (_data, vars) => invalidateAfterUpdateConversation(qc, transport.kind, vars.id),
  });
}

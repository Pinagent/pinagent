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
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Conversation } from '../fixtures/types';
import { type ConversationUpdate, useTransport } from '../transport';

export interface UpdateConversationVariables {
  id: string;
  patch: ConversationUpdate;
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
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
        qc.invalidateQueries({ queryKey: ['conversation', transport.kind, vars.id] }),
      ]);
    },
  });
}

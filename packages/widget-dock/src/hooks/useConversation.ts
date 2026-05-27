// SPDX-License-Identifier: Apache-2.0
/**
 * Detail read for a single conversation. Goes through the transport
 * (no direct fetch). Suspends to loading on first fetch; subsequent
 * cache hits return immediately.
 *
 * Disabled when id is null so the hook is safe to call unconditionally
 * even when no conversation is open.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type ConversationDetail, useTransport } from '../transport';

export function useConversation(id: string | null): UseQueryResult<ConversationDetail | null> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['conversation', transport.kind, id],
    queryFn: () => (id ? transport.getConversation(id) : Promise.resolve(null)),
    enabled: id != null,
  });
}

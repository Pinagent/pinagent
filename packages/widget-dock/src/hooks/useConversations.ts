// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hooks for conversations. Goes through the injected
 * DockTransport — no component should `fetch` directly.
 *
 * `queryKey` uses the transport.kind as a discriminator so swapping
 * mock ↔ local in the dev preview doesn't serve stale data from the
 * other source.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { Conversation } from '../fixtures/types';
import { type ConversationFilters, useTransport } from '../transport';

export function useConversations(filters?: ConversationFilters): UseQueryResult<Conversation[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['conversations', transport.kind, filters ?? null],
    queryFn: () => transport.listConversations(filters),
  });
}

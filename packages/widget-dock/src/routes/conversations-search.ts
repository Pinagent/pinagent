// SPDX-License-Identifier: Apache-2.0
/**
 * `validateSearch` for the `/conversations` route. Pulled into its own
 * file so tests can import it without dragging the whole router (and
 * the lazy-route imports it pulls) through Vite's transform pipeline.
 *
 * Wire shape: `{ id?: string }`. Any other search params are dropped
 * silently; a malformed or empty `id` collapses to absent.
 */
export interface ConversationsSearch {
  id?: string;
}

export function validateConversationsSearch(search: Record<string, unknown>): ConversationsSearch {
  const id = typeof search.id === 'string' && search.id.length > 0 ? search.id : undefined;
  return id ? { id } : {};
}

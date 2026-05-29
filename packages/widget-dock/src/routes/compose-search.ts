// SPDX-License-Identifier: Apache-2.0
/**
 * `validateSearch` for the `/prs/new` route. Pulled into its own file
 * so tests can import it without dragging the whole router (and the
 * lazy-route imports it pulls) through Vite's transform pipeline.
 *
 * Wire shape: `{ ids?: string }` — a comma-separated list of
 * conversation ids to pre-check in the composer's picker. The Changes
 * view builds this when the user multi-selects rows and clicks "Create
 * PR"; opening `/prs/new` cold (from the PRs tab) omits it entirely.
 *
 * Any other search params are dropped silently; a malformed or empty
 * `ids` collapses to absent. Blank segments (e.g. trailing commas) are
 * filtered out so the picker never tries to match an empty id.
 */
export interface ComposeSearch {
  ids?: string;
}

/** Parsed pre-selection: the conversation ids to pre-check, in order. */
export function parseComposeIds(search: ComposeSearch): string[] {
  if (typeof search.ids !== 'string' || search.ids.length === 0) return [];
  return search.ids
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function validateComposeSearch(search: Record<string, unknown>): ComposeSearch {
  const ids = typeof search.ids === 'string' && search.ids.length > 0 ? search.ids : undefined;
  return ids ? { ids } : {};
}

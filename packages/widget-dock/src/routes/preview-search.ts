// SPDX-License-Identifier: Apache-2.0
/**
 * `validateSearch` for the `/preview` route. Pulled into its own file so
 * tests can import it without dragging the whole router through Vite's
 * transform pipeline.
 *
 * Wire shape: `{ id?: string }` — the conversation id of the worktree to
 * preview. Drives deep-linking from the Branches "Open in dock" action
 * and keeps the active selection in the URL so it survives in-dock
 * navigation. A malformed or empty `id` collapses to absent (→ main app).
 */
export interface PreviewSearch {
  id?: string;
}

export function validatePreviewSearch(search: Record<string, unknown>): PreviewSearch {
  const id = typeof search.id === 'string' && search.id.length > 0 ? search.id : undefined;
  return id ? { id } : {};
}

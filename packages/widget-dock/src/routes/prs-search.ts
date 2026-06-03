// SPDX-License-Identifier: Apache-2.0
/**
 * `validateSearch` for the `/prs` route. Pulled into its own file so
 * tests can import it without dragging the whole router (and the lazy
 * route imports it pulls) through Vite's transform pipeline.
 *
 * Wire shape: `{ number?: number }` — the PR to scroll into view and
 * briefly highlight, set when the History/Overview activity feed
 * deep-links a `pr_created` row into this tab. Any other search params
 * are dropped silently; a missing / non-positive-integer `number`
 * collapses to absent (the tab just renders its list normally).
 *
 * `number` arrives as a real number through in-app `<Link>` navigation
 * but as a string from a pasted URL or back/forward, so both are
 * coerced.
 */
export interface PrsSearch {
  number?: number;
}

export function validatePrsSearch(search: Record<string, unknown>): PrsSearch {
  const raw = search.number;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? { number: n } : {};
}

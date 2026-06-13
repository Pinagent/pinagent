// SPDX-License-Identifier: Apache-2.0
/**
 * Restore-filter: turn the server's feedback list into the minimized pills the
 * RN widget seeds on mount, so an app reload mid-run brings the running streams
 * back instead of losing them.
 *
 * The dev server (`.pinagent/db.sqlite`) is the source of truth — RN keeps no
 * device-local mirror (see ticket 001). On `<Pinagent/>` mount we
 * `GET /__pinagent/feedback`, run the list through {@link restorePills}, and
 * seed `streams` with the result; each restored id then subscribes over the
 * existing WS client, which replays the transcript (and fires `done` for
 * already-finished runs).
 *
 * This module is pure (no RN runtime imports) so it's unit-testable here. The
 * filter mirrors the web widget's `listPendingForCurrentPage`
 * (`packages/widget/src/db/reads.ts`): pending-only, scoped to the current
 * surface URL, newest first.
 */

/** Default cap so a stale backlog doesn't flood the screen with pills. */
export const RESTORE_LIMIT = 5;

/** A minimized run pill: the same shape `<Pinagent/>` keeps in `streams`. */
export interface RestoredPill {
  id: string;
  /** Header label — `file:line` if anchored, else the selector/component. */
  target: string;
}

/**
 * The subset of a feedback list item (`storage.list()` projection,
 * `FeedbackRecord`) this filter reads. Loosely typed so it tolerates the wire
 * JSON without importing the agent-runner type into RN source.
 */
export interface RestoreCandidate {
  id?: unknown;
  status?: unknown;
  url?: unknown;
  file?: unknown;
  line?: unknown;
  selector?: unknown;
  updatedAt?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Human-readable target for the pill header (mirrors `onSubmit`'s logic). */
function targetFor(item: RestoreCandidate): string {
  if (isNonEmptyString(item.file) && typeof item.line === 'number') {
    return `${item.file}:${item.line}`;
  }
  if (isNonEmptyString(item.selector)) {
    // The selector is the component name-chain ("App > Home > Button"); the
    // innermost (tapped) component is the most useful label.
    const last = item.selector.split('>').pop()?.trim();
    if (last) return last;
  }
  return 'component';
}

/**
 * Filter a feedback list to the pills worth restoring on this surface:
 *
 * - `status === 'pending'` — resolved/dismissed runs don't come back (web parity).
 * - `url === surfaceUrl` — RN submits `url: screenName ?? Platform.OS`; a run
 *   started on a different screen would restore at meaningless coordinates.
 * - newest first by `updatedAt`, capped at `limit` (default {@link RESTORE_LIMIT}).
 *
 * Items missing an `id` are dropped (can't subscribe to them).
 */
export function restorePills(
  items: readonly RestoreCandidate[] | null | undefined,
  surfaceUrl: string,
  limit: number = RESTORE_LIMIT,
): RestoredPill[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => isNonEmptyString(it.id) && it.status === 'pending' && it.url === surfaceUrl)
    .sort((a, b) => updatedAtMs(b.updatedAt) - updatedAtMs(a.updatedAt))
    .slice(0, Math.max(0, limit))
    .map((it) => ({ id: it.id as string, target: targetFor(it) }));
}

/** Parse an ISO `updatedAt` to epoch ms; unparseable values sort oldest (0). */
function updatedAtMs(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : ms;
}

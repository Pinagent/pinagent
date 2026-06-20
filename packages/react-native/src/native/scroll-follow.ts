// SPDX-License-Identifier: Apache-2.0
/**
 * Pure scroll-follow predicate for the RN widget's live transcript.
 *
 * The expanded `StreamSheet` transcript used to call `scrollToEnd` on every
 * content change, so scrolling up to re-read earlier output during an active run
 * got yanked back to the bottom by the next event. The fix is the standard
 * chat-log "stick to bottom only while already near the bottom" behavior — and
 * the near-bottom test is the one piece of math worth pulling out of the
 * un-testable RN-runtime layer (mirrors how `run-state.ts` / `transcript.ts`
 * keep their logic pure, see packages/react-native/src/native).
 */

/** Default slack (in px) for treating "almost at the bottom" as "at bottom". */
export const NEAR_BOTTOM_THRESHOLD = 24;

export interface NearBottomInput {
  /** `contentOffset.y` — how far the content is scrolled up from the top. */
  offsetY: number;
  /** `layoutMeasurement.height` — the visible viewport height. */
  viewportH: number;
  /** `contentSize.height` — the full scrollable content height. */
  contentH: number;
  /** Slack in px; the gap to the bottom that still counts as "at bottom". */
  threshold?: number;
}

/**
 * True when the scroll position is within `threshold` px of the bottom (so
 * auto-follow should keep pinning new content into view). Pure and tolerant of
 * the bouncy/over-scroll values RN can report: a negative remaining distance
 * (rubber-band past the end) still reads as at-bottom, and content shorter than
 * the viewport is always at-bottom. A non-finite or non-positive threshold
 * falls back to {@link NEAR_BOTTOM_THRESHOLD}.
 */
export function isNearBottom({
  offsetY,
  viewportH,
  contentH,
  threshold = NEAR_BOTTOM_THRESHOLD,
}: NearBottomInput): boolean {
  const slack = Number.isFinite(threshold) && threshold > 0 ? threshold : NEAR_BOTTOM_THRESHOLD;
  // Content that doesn't fill the viewport can't be scrolled — always pinned.
  if (contentH <= viewportH) return true;
  const distanceFromBottom = contentH - (offsetY + viewportH);
  return distanceFromBottom <= slack;
}

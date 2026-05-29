// SPDX-License-Identifier: Apache-2.0
import { formatCompactUsd } from '@pinagent/shared';
import { BRAND_GOLD, FONT_SANS, STATUS, type StatusKey } from '@pinagent/ui/tokens';
import { BRAND_CREAM, BRAND_INK, PICKER_CURSOR_DATA_URL } from './brand';

export const ENDPOINT = '/__pinagent/feedback';
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** Human labels for the unresolved statuses the agents tray surfaces. */
export const STATUS_LABEL: Partial<Record<StatusKey, string>> = {
  working: 'Working',
  readyToLand: 'Ready to land',
  awaitingClarification: 'Needs your input',
};

/** Glanceable per-row meta: "5 msg · $0.34". Empty when nothing to show.
 * Cost formatting is shared with the dock via `formatCompactUsd` so the
 * tray and the dock's cost chip can't drift. */
export function trayRowMeta(messageCount: number, costUsd: number): string {
  const parts: string[] = [];
  if (messageCount > 0) parts.push(`${messageCount} msg`);
  if (costUsd > 0) parts.push(formatCompactUsd(costUsd));
  return parts.join(' · ');
}

/** Two-column dot grip for the tray's drag handle (mirrors the composer's). */
export const ICON_GRIP =
  '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="2" cy="2" r="1.3"/><circle cx="6" cy="2" r="1.3"/>' +
  '<circle cx="2" cy="7" r="1.3"/><circle cx="6" cy="7" r="1.3"/>' +
  '<circle cx="2" cy="12" r="1.3"/><circle cx="6" cy="12" r="1.3"/></svg>';

export const COMPOSER_H = 320;
export const STREAM_H = 340;
// Minimized "mini progress card" height — tall enough for the status
// line, the component/loop context line, the last two activity rows,
// and the turns/cost footer. Reuses IFRAME_W for width so
// reposition()/drag/pointer math is untouched.
export const MINI_H = 150;
export const IFRAME_W = 400;
export const BUBBLE_SIZE = 36;

/**
 * Auto-grow envelope for the pre-submit composer. The textarea inside
 * the iframe measures its natural scrollHeight on input and posts it
 * to the parent; the parent grows or shrinks the iframe by the delta
 * from MIN_TA_H, clamped to MAX_TA_H. Past the cap, the textarea
 * scrolls internally rather than pushing the composer off-screen.
 */
export const MIN_TA_H = 80;
export const MAX_TA_H = 240;

/**
 * Document-level styles for elements that live in document.body (iframes
 * and bubbles). They can't live in the shadow root because we want them
 * to scroll naturally with the page — children of a `position: fixed`
 * shadow host are pinned to the viewport regardless of their own
 * `position: absolute`.
 *
 * The picker cursor rule also lives here so it can cover the whole page.
 */
export const DOC_STYLES = `
/* Custom pin cursor while picking. The pin is rotated 135° around
   the viewBox centre so the tip points to roughly 10:30 (upper-left
   diagonal), lining up with how browser arrow cursors normally aim.
   Cream stroke + dark fill so it stays legible on both light and
   dark backgrounds. Hotspot (~9, 9) lands on the rotated tip in
   32x32 cursor space. The crosshair fallback covers browsers that
   won't render SVG cursors. */
:root.pa-picking, :root.pa-picking * {
  cursor: ${PICKER_CURSOR_DATA_URL}, crosshair !important;
}

.pa-iframe {
  position: absolute;
  border: 0;
  background: transparent;
  z-index: 2147483646;
  color-scheme: light;
  /* iframe is positioned relative to documentElement origin — set via JS */
}
.pa-iframe[hidden] { display: none; }

.pa-bubble {
  position: absolute;
  width: ${BUBBLE_SIZE}px;
  height: ${BUBBLE_SIZE}px;
  border-radius: 50%;
  background: ${BRAND_CREAM};
  border: 2px solid #e8dfb0;
  box-shadow: 0 4px 12px rgba(32, 27, 33, 0.16);
  cursor: pointer;
  z-index: 2147483645;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: ${BRAND_INK};
  transition: transform 120ms ease, box-shadow 120ms ease;
  font-family: ${FONT_SANS};
}
.pa-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 16px rgba(32, 27, 33, 0.22); }
.pa-bubble[hidden] { display: none; }

/* Status-driven bubble variants. Color palette comes from
   @pinagent/ui/tokens.STATUS so the bubble visually matches the
   dock's status badges. */
.pa-bubble.pending {
  border-color: ${STATUS.pending.border};
  background: ${STATUS.pending.bg};
  color: ${STATUS.pending.fg};
}
.pa-bubble.running {
  border-color: ${STATUS.working.border};
  background: ${STATUS.working.bg};
  color: ${STATUS.working.fg};
}
.pa-bubble.running::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid ${STATUS.working.fg};
  opacity: 0.55;
  animation: pa-bubble-pulse 1.6s ease-out infinite;
  pointer-events: none;
}
@keyframes pa-bubble-pulse {
  0%   { transform: scale(1);    opacity: 0.55; }
  100% { transform: scale(1.55); opacity: 0; }
}
.pa-bubble.done {
  border-color: ${STATUS.readyToLand.border};
  background: ${STATUS.readyToLand.bg};
  color: ${STATUS.readyToLand.fg};
}
.pa-bubble.error {
  border-color: ${STATUS.error.border};
  background: ${STATUS.error.bg};
  color: ${STATUS.error.fg};
}
/* Phase G — anchor lost. Dashed olive ring so it reads as "needs attention"
   without claiming an outright error. Click retries the re-anchor lookup. */
.pa-bubble.anchor-lost {
  border-style: dashed;
  border-color: ${STATUS.anchorLost.border};
  background: ${STATUS.anchorLost.bg};
  color: ${STATUS.anchorLost.fg};
}

.pa-bubble-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: pa-bubble-spin 0.9s linear infinite;
}
@keyframes pa-bubble-spin { to { transform: rotate(360deg); } }

.pa-drag-handle {
  position: absolute;
  width: 16px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 2147483646;
  color: #8a8270;
  border-radius: 4px;
  transition: color 100ms ease, background 100ms ease, box-shadow 100ms ease;
}
.pa-drag-handle svg { display: block; }
.pa-drag-handle:hover { color: ${BRAND_INK}; background: #f5efd0; }
.pa-drag-handle.dragging {
  cursor: grabbing;
  color: ${BRAND_INK};
  background: #f5efd0;
  box-shadow: 0 0 0 3px ${BRAND_GOLD};
}
.pa-drag-handle[hidden] { display: none; }

.pa-pointer {
  position: absolute;
  width: 18px;
  height: 10px;
  pointer-events: none;
  z-index: 2147483646;
  overflow: visible;
}
.pa-pointer[hidden] { display: none; }

/* Smooth the bubble's color transition when the anchor is lost — the
   class flips on suddenly during HMR / DOM rewrites, so a brief fade
   reads less like an error spike. */
.pa-bubble {
  transition: transform 120ms ease,
              box-shadow 120ms ease,
              background 220ms ease,
              border-color 220ms ease,
              color 220ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .pa-bubble, .pa-bubble:hover,
  .pa-drag-handle, .pa-drag-handle.dragging {
    transition: none !important;
    transform: none !important;
  }
  .pa-bubble.running::after { animation: none; opacity: 0.3; }
  .pa-bubble-spinner { animation: none; }
}
`;

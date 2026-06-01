// SPDX-License-Identifier: Apache-2.0
import { formatCompactUsd } from '@pinagent/shared';
import { FONT_SANS, type StatusKey } from '@pinagent/ui/tokens';
import { PICKER_CURSOR_DATA_URL } from './brand';
import { STATUS, THEME } from './theme';

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

/** Minimize glyph for the tray handle — collapses the tray back to the pin. */
export const ICON_MINIMIZE =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
  '<path d="M3 7h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export const COMPOSER_H = 320;
export const STREAM_H = 340;
// Minimized height — the single-line minimal bar (viewState: 'minimal').
// Just the card padding (4px top/bottom) plus one 24px action row, so the
// status indicator, label, and icon cluster sit on one compact line. Reuses
// IFRAME_W for width so reposition()/drag/pointer math is untouched.
export const MINI_H = 36;
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
 * Delay before a completed conversation that's still collapsed (minimal
 * bar or floating bubble) auto-closes itself. Cancelled if the user
 * expands or otherwise interacts. Expanded conversations never auto-close.
 */
export const AUTO_CLOSE_MS = 5_000;

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
/* Region-snip sub-mode: a plain crosshair while the user drags out a
   rectangle (overrides the pin cursor above). */
:root.pa-region, :root.pa-region * {
  cursor: crosshair !important;
}

.pa-iframe {
  position: absolute;
  border: 0;
  background: transparent;
  z-index: 2147483646;
  color-scheme: dark;
  /* iframe is positioned relative to documentElement origin — set via JS */
}
.pa-iframe[hidden] { display: none; }

.pa-bubble {
  position: absolute;
  width: ${BUBBLE_SIZE}px;
  height: ${BUBBLE_SIZE}px;
  border-radius: 50%;
  background: ${THEME.surface};
  border: 2px solid ${THEME.border};
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  z-index: 2147483645;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: ${THEME.text};
  transition: transform 120ms ease, box-shadow 120ms ease;
  font-family: ${FONT_SANS};
}
.pa-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22); }
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
/* Needs human input — the agent asked a question (ask_user) while
   collapsed to the dot. Mirrors the minimal bar's awaitingClarification
   language: the alert glyph replaces the spinner, the running pulse ring
   is dropped, and the dot pulses on its own to pull attention. Defined
   after the .running rule so its ::after override wins on equal specificity. */
.pa-bubble.needs-input {
  border-color: ${STATUS.awaitingClarification.border};
  background: ${STATUS.awaitingClarification.bg};
  color: ${STATUS.awaitingClarification.fg};
  font-size: 13px;
  line-height: 1;
  animation: pa-bubble-attn 1.6s ease-out infinite;
}
.pa-bubble.needs-input .pa-bubble-spinner { display: none; }
.pa-bubble.needs-input::after { display: none; }
.pa-bubble.needs-input::before { content: '▲'; }
@keyframes pa-bubble-attn {
  0%, 100% { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16), 0 0 0 0 ${STATUS.awaitingClarification.border}; }
  50%      { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16), 0 0 0 4px ${STATUS.awaitingClarification.border}; }
}

.pa-bubble-spinner {
  width: 9px;
  height: 9px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: pa-bubble-spin 0.9s linear infinite;
}
@keyframes pa-bubble-spin { to { transform: rotate(360deg); } }

/* Archive control on the anchor-lost dot. Small circular button at the
   dot's upper-right corner; only shown when the orphaned dot is visible
   (toggled via [hidden] in reposition()). Sits one z-index above the
   bubble so it stays clickable on top of it. */
.pa-anchor-lost-dismiss {
  position: absolute;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid ${THEME.border};
  background: ${THEME.surface};
  color: ${THEME.text};
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  font-family: ${FONT_SANS};
}
.pa-anchor-lost-dismiss:hover {
  background: ${STATUS.error.bg};
  border-color: ${STATUS.error.border};
  color: ${STATUS.error.fg};
}
.pa-anchor-lost-dismiss[hidden] { display: none; }

/* Floating-bubble action row (viewState: 'bubble'). Mirrors the minimal
   bar's affordances — stop while running, cancel always — as a small pill
   tucked under the dot. Revealed on hover/focus of the dot or the row
   (JS toggles \`.show\`, with a short hide delay so the gap is traversable). */
.pa-bubble-actions {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: ${THEME.surface};
  border: 1px solid ${THEME.border};
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 2147483646;
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
}
.pa-bubble-actions.show { opacity: 1; transform: translateY(0); pointer-events: auto; }
.pa-bubble-actions[hidden] { display: none; }
.pa-ba-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${THEME.text};
  cursor: pointer;
  font-family: ${FONT_SANS};
}
.pa-ba-btn:hover { background: ${THEME.hover}; }
.pa-ba-btn svg { width: 15px; height: 15px; display: block; }
.pa-ba-btn.danger { color: ${STATUS.error.fg}; }
.pa-ba-btn.danger:hover { background: ${STATUS.error.bg}; }
.pa-ba-btn[hidden] { display: none; }

.pa-drag-handle {
  position: absolute;
  width: 16px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 2147483646;
  color: ${THEME.textMuted};
  border-radius: 4px;
  transition: color 100ms ease, background 100ms ease, box-shadow 100ms ease;
}
.pa-drag-handle svg { display: block; }
.pa-drag-handle:hover { color: ${THEME.text}; background: ${THEME.hover}; }
.pa-drag-handle.dragging {
  cursor: grabbing;
  color: ${THEME.text};
  background: ${THEME.hover};
  box-shadow: 0 0 0 3px ${THEME.accent};
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

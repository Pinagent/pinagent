// SPDX-License-Identifier: Apache-2.0
/**
 * Shadow-root CSS for the picker FAB, the element-picker outline, and
 * the picker hint banner. Templated from @pinagent/ui/tokens so the
 * widget reads as the same brand as the dock — cream surfaces, ink
 * text, gold accent for "active" state.
 *
 * `:host { all: initial; }` + explicit `color-scheme: light;` keep the
 * styles isolated from the host page's dark-mode CSS variables and
 * user-agent form-control theming.
 */
import { BRAND_CREAM, BRAND_GOLD, BRAND_INK, FONT_SANS, STATUS } from '@pinagent/ui/tokens';

export const STYLES = `
:host {
  all: initial;
  /* color-scheme is one of the few properties that pierces shadow DOM —
     force light so the host page's dark scheme doesn't paint our form
     controls (textarea, button) with dark browser defaults. */
  color-scheme: light;
}
* { box-sizing: border-box; font-family: ${FONT_SANS}; }

.fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: ${BRAND_INK};
  color: ${BRAND_CREAM};
  border: 0;
  cursor: pointer;
  font-size: 22px;
  box-shadow: 0 10px 28px rgba(32, 27, 33, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Sit above any composer iframe (those use 2147483646) so the FAB stays
     clickable even when an open composer overlaps the bottom-right. */
  z-index: 2147483647;
  /* Smooth corner-snap animation. Disabled mid-drag via .dragging so the
     position tracks the cursor 1:1 without interpolation lag. */
  transition: top 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
              bottom 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
              left 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
              right 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
              transform 120ms ease,
              background 120ms ease,
              box-shadow 120ms ease;
}
.fab.dragging {
  transition: none;
  cursor: grabbing;
  transform: scale(1.08);
}
.fab:hover {
  transform: scale(1.06);
  box-shadow: 0 14px 32px rgba(32, 27, 33, 0.34);
}
/* "Active" = picker mode. Gold ring + slight scale, ink stays — keeps
   the pin recognizable while flagging "click an element next". */
.fab.active {
  box-shadow: 0 0 0 3px ${BRAND_GOLD}, 0 10px 28px rgba(32, 27, 33, 0.32);
}

/* Keyboard-shortcut chip for opening the dock. Only rendered when the
   host mounts the dock (resolveDockEnabled). Absolutely positioned inside
   the fixed FAB so it tracks the FAB through drag + corner-snap. Sits over
   the top edge, "overlaying it a bit". pointer-events:none so clicks pass
   through to the FAB (which always opens the picker). */
.fab-shortcut {
  position: absolute;
  bottom: calc(100% - 9px);
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 7px;
  border-radius: 999px;
  background: ${BRAND_GOLD};
  color: ${BRAND_INK};
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 6px rgba(32, 27, 33, 0.22);
  pointer-events: none;
}

/* Running-agents indicator on the collapsed pin. Shown only when the tray
   was minimized while agents are still live (renderPinContent passes the
   hidden agents through). The badge counts them; the pulse ring flags that
   at least one is actively working. Colour mirrors the tray's working dot so
   the minimized and expanded presentations read the same. */
.fab-agent-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 999px;
  background: ${STATUS.working.fg};
  color: ${BRAND_CREAM};
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 2px 6px rgba(32, 27, 33, 0.28);
  pointer-events: none;
}
.fab.running::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid ${STATUS.working.fg};
  opacity: 0.6;
  animation: pa-fab-pulse 1.6s ease-out infinite;
  pointer-events: none;
}
@keyframes pa-fab-pulse {
  0% { transform: scale(0.92); opacity: 0.6; }
  70% { transform: scale(1.18); opacity: 0; }
  100% { transform: scale(1.18); opacity: 0; }
}

/* ---- Running-agents tray ------------------------------------------------
   The same fixed element as the FAB (so drag + corner-snap are reused),
   re-skinned from a 48px circle into a panel when agents are running.
   .fab keeps the fixed positioning, shadow, and z-index; these rules
   override shape + layout. */
.fab.tray {
  width: 300px;
  height: auto;
  max-height: 60vh;
  border-radius: 14px;
  padding: 0;
  cursor: default;
  align-items: stretch;
  flex-direction: column;
  overflow: hidden;
  font-size: 13px;
}
/* No hover-scale in tray mode — it's a panel, not a button. */
.fab.tray:hover {
  transform: none;
  box-shadow: 0 14px 32px rgba(32, 27, 33, 0.34);
}

.pa-tray-handle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid rgba(252, 249, 232, 0.12);
}
.fab.tray.dragging .pa-tray-handle { cursor: grabbing; }
.pa-tray-grip { display: inline-flex; color: rgba(252, 249, 232, 0.5); flex-shrink: 0; }
.pa-tray-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pa-tray-pick {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: rgba(252, 249, 232, 0.12);
  color: ${BRAND_CREAM};
  cursor: pointer;
}
.pa-tray-pick:hover { background: rgba(252, 249, 232, 0.22); }
.pa-tray-min {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(252, 249, 232, 0.7);
  cursor: pointer;
}
.pa-tray-min:hover { background: rgba(252, 249, 232, 0.12); color: ${BRAND_CREAM}; }

.pa-tray-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pa-tray-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
}
.pa-tray-row:hover { background: rgba(252, 249, 232, 0.06); }
.pa-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${STATUS.pending.fg};
}
.pa-status-dot[data-status="working"] {
  background: ${STATUS.working.fg};
  animation: pa-tray-pulse 1.4s ease-in-out infinite;
}
.pa-status-dot[data-status="readyToLand"] { background: ${STATUS.readyToLand.fg}; }
.pa-status-dot[data-status="awaitingClarification"] { background: ${STATUS.awaitingClarification.fg}; }
@keyframes pa-tray-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.pa-tray-rowmain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pa-tray-rowtitle {
  min-width: 0;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pa-tray-meta {
  font-size: 10px;
  color: rgba(252, 249, 232, 0.55);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pa-tray-actions { display: inline-flex; gap: 4px; flex-shrink: 0; }
.pa-tray-btn {
  border: 0;
  background: rgba(252, 249, 232, 0.12);
  color: ${BRAND_CREAM};
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.pa-tray-btn:hover { background: rgba(252, 249, 232, 0.24); }
.pa-tray-btn:disabled { opacity: 0.5; cursor: default; }
.pa-tray-btn.danger:hover { background: ${STATUS.error.fg}; color: ${BRAND_CREAM}; }

.outline {
  position: fixed;
  pointer-events: none;
  border: 2px solid ${BRAND_INK};
  background: rgba(255, 215, 0, 0.12);
  z-index: 2147483646;
  transition: all 60ms ease;
  border-radius: 4px;
}
/* Persistent outlines drawn for each Cmd/Ctrl-click pick that hasn't
   committed yet. Same look as the hover outline but solid gold edge so
   "queued" reads as more committed than "hovering". No transition so
   they don't drift while the page scrolls under the rAF loop. */
.selection-outline {
  position: fixed;
  pointer-events: none;
  border: 2px solid ${BRAND_GOLD};
  background: rgba(255, 215, 0, 0.18);
  z-index: 2147483646;
  border-radius: 4px;
}
/* Order number for each committed selection (element or region). Sits at
   the outline's top-left corner so multi-node picks read "1, 2, 3…". */
.selection-badge {
  position: absolute;
  top: -10px;
  left: -10px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 999px;
  background: ${BRAND_INK};
  color: ${BRAND_CREAM};
  border: 2px solid ${BRAND_GOLD};
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(32, 27, 33, 0.28);
}
/* The rubber-band rectangle drawn while in region-snip mode. Dashed so it
   reads as "being drawn" vs. the solid committed selection outlines. */
.region-drawing {
  position: fixed;
  pointer-events: none;
  border: 2px dashed ${BRAND_INK};
  background: rgba(255, 215, 0, 0.12);
  z-index: 2147483646;
  border-radius: 4px;
}

.hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: ${BRAND_INK};
  color: ${BRAND_CREAM};
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(32, 27, 33, 0.28);
  font-weight: 500;
}

/* Inline-mode shadow-root composer (separate from the iframe composer in
   composer-styles.ts). Same cream + ink + soft shadow language. */
.composer {
  position: fixed;
  width: 320px;
  background: ${BRAND_CREAM};
  border: 1px solid #e8dfb0;
  border-radius: 10px;
  box-shadow: 0 10px 25px rgba(32, 27, 33, 0.18);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Override UA popover defaults so our inline top/left win. The UA sheet
     for [popover] sets inset:0 + margin:auto which would center us. */
  inset: auto;
  margin: 0;
  color: ${BRAND_INK};
  overflow: visible;
}
.composer::backdrop { background: transparent; }
.composer .meta {
  font-size: 11px;
  color: #5c5546;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}
.composer textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  padding: 8px;
  font-size: 13px;
  border: 1px solid #e8dfb0;
  border-radius: 6px;
  outline: none;
  font-family: inherit;
  background: #fffdf3;
  color: ${BRAND_INK};
}
.composer textarea::placeholder { color: #8a8270; }
.composer textarea:focus {
  border-color: ${BRAND_INK};
  box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.40);
}

.row { display: flex; justify-content: flex-end; gap: 8px; }
.btn {
  border: 0;
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
.btn.primary { background: ${BRAND_INK}; color: ${BRAND_CREAM}; }
.btn.primary:hover { background: #2a2528; }
.btn.primary:disabled { background: #8a8270; cursor: not-allowed; }
.btn.ghost { background: transparent; color: ${BRAND_INK}; }
.btn.ghost:hover { background: rgba(32, 27, 33, 0.06); }

.toast {
  position: fixed;
  bottom: 80px;
  right: 20px;
  background: ${BRAND_INK};
  color: ${BRAND_CREAM};
  padding: 10px 14px;
  font-size: 13px;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(32, 27, 33, 0.28);
}
.toast.error { background: ${STATUS.error.fg}; color: ${BRAND_CREAM}; }

@media (prefers-reduced-motion: reduce) {
  .fab, .fab:hover, .fab.dragging,
  .outline, .composer textarea {
    transition: none !important;
  }
  .fab:hover { transform: none; }
  .pa-status-dot[data-status="working"] { animation: none; }
  .fab.running::after { animation: none; }
}
`;

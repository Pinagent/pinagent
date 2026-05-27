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

.outline {
  position: fixed;
  pointer-events: none;
  border: 2px solid ${BRAND_INK};
  background: rgba(255, 215, 0, 0.12);
  z-index: 2147483646;
  transition: all 60ms ease;
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
}
`;

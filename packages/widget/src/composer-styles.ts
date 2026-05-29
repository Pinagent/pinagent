// SPDX-License-Identifier: Apache-2.0
/**
 * Inline CSS for the composer iframe (composerHTML in widget.ts).
 *
 * Templated from @pinagent/ui/tokens so the composer reads as the same
 * brand as the dock — cream surfaces, ink text, gold accent, status
 * colors tuned for cream. Token values inline at module-load time;
 * the string is dropped into the iframe's <style> block via srcdoc.
 */
import {
  BRAND_CREAM,
  BRAND_GOLD,
  BRAND_INK,
  FONT_MONO,
  FONT_SANS,
  STATUS,
} from '@pinagent/ui/tokens';

export const COMPOSER_STYLES = `
  html, body { margin: 0; padding: 0; background: transparent; height: 100%; }
  * { box-sizing: border-box; font-family: ${FONT_SANS}; }
  body { color: ${BRAND_INK}; }
  .card {
    background: ${BRAND_CREAM};
    border: 1px solid #e8dfb0;
    border-radius: 10px;
    box-shadow: 0 10px 25px rgba(32, 27, 33, 0.18);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: calc(100% - 2px);
  }
  .pane { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
  .pane[hidden] { display: none; }

  /* --- Header block (identity + file + breadcrumb) --------------- */
  .header-block {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e8dfb0;
  }
  .hdr-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .hdr-row[hidden] { display: none; }

  /* Identity row: tag pill + quoted label. Pill uses ink-on-cream so
     it visually matches the same tag highlighted in the breadcrumb.
     The right padding reserves space for the drag handle that the
     parent positions inside the iframe's top-right corner. */
  .hdr-identity { padding-right: 28px; }
  .el-pill {
    display: inline-flex;
    align-items: center;
    font-family: ${FONT_MONO};
    font-size: 11px;
    font-weight: 600;
    background: ${BRAND_INK};
    color: ${BRAND_CREAM};
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .el-label {
    font-size: 13px;
    font-weight: 500;
    color: ${BRAND_INK};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  /* "+N more" badge for Cmd/Ctrl-click extras. Same shape as el-pill
     but gold so it stands out as "additional selections". Cursor: help
     so the hover-to-preview affordance reads. */
  .el-extras-wrap { display: inline-flex; flex-shrink: 0; }
  .el-extras {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    background: ${BRAND_GOLD};
    color: ${BRAND_INK};
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    cursor: help;
  }
  .el-extras:focus-visible { outline: 2px solid ${BRAND_INK}; outline-offset: 1px; }

  /* Popover listing every selected element. Anchored to the header
     block's right edge (not the badge) so it always grows leftward and
     stays inside the 400px iframe regardless of where the badge lands.
     Shown via '.open' (JS, mouse — with a hide delay so the gap between
     badge and popover is traversable) or ':focus-within' (keyboard).
     Capped height with internal scroll for deep multi-picks. */
  .el-extras-pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    display: none;
    min-width: 220px;
    max-width: 320px;
    max-height: 232px;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #e8dfb0;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(32, 27, 33, 0.18);
    padding: 8px 10px;
    text-align: left;
  }
  .el-extras-pop.open,
  .el-extras-wrap:focus-within .el-extras-pop { display: block; }
  .ex-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8a7a2e;
    margin-bottom: 6px;
  }
  .ex-row { display: flex; flex-direction: column; gap: 2px; padding: 5px 0; }
  .ex-row + .ex-row { border-top: 1px solid #f0e9cf; }
  .ex-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .ex-pill {
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 600;
    background: ${BRAND_INK};
    color: ${BRAND_CREAM};
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .ex-label {
    font-size: 12px;
    color: ${BRAND_INK};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .ex-tag-primary {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8a7a2e;
    background: ${BRAND_GOLD};
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .ex-loc {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: #5c5546;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* File row (#pa-meta): code icon + path:line:col + external-link
     icon. The whole row is the click target for open-in-editor when
     loc resolved. Hover/loading/ok/err mirror the old .meta states. */
  .hdr-file {
    font-size: 11px;
    color: #5c5546;
    font-family: ${FONT_MONO};
    padding: 2px 6px;
    margin: 0 -6px;
    border-radius: 4px;
    transition: background 100ms ease, color 100ms ease, opacity 100ms ease;
    user-select: none;
  }
  .hdr-file-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hdr-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    opacity: 0.65;
  }
  .hdr-file.clickable { cursor: pointer; }
  .hdr-file.clickable:hover { background: #f5efd0; color: ${BRAND_INK}; }
  .hdr-file.clickable:hover .hdr-icon { opacity: 1; }
  .hdr-file.loading { opacity: 0.5; }
  .hdr-file.ok { background: ${STATUS.landed.bg}; color: ${STATUS.landed.fg}; }
  .hdr-file.err { background: ${STATUS.error.bg}; color: ${STATUS.error.fg}; }

  /* Breadcrumb: chain of tag pills, last one (the picked element)
     gets the same selected style as the identity pill. */
  .hdr-bc {
    font-family: ${FONT_MONO};
    font-size: 11px;
    flex-wrap: wrap;
    gap: 4px;
  }
  .bc-item {
    color: #8a8270;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .bc-item.bc-selected {
    background: ${BRAND_INK};
    color: ${BRAND_CREAM};
    font-weight: 600;
  }
  .bc-sep {
    color: #b8ad88;
    font-size: 12px;
    user-select: none;
  }

  /* --- Quick-action chips ------------------------------------- */
  .qa-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .qa-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: ${BRAND_INK};
    background: transparent;
    border: 1px solid #e8dfb0;
    border-radius: 999px;
    padding: 5px 10px;
    cursor: pointer;
    transition: background 100ms ease, border-color 100ms ease, box-shadow 100ms ease;
  }
  .qa-chip:hover {
    background: #f5efd0;
    border-color: ${BRAND_INK};
  }
  .qa-chip:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.45);
  }
  .qa-icon { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.85; }

  /* --- Footer kbd hint --------------------------------------- */
  .footer-row { padding-top: 2px; }
  .kbd-hint {
    font-size: 11px;
    color: #5c5546;
    font-family: ${FONT_MONO};
    user-select: none;
  }
  .kbd-hint kbd {
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${BRAND_INK};
    background: #f5efd0;
    border: 1px solid #e8dfb0;
    border-radius: 3px;
    padding: 0 4px;
    margin-right: 2px;
  }
  textarea {
    width: 100%;
    resize: none;
    padding: 8px;
    font-size: 13px;
    border: 1px solid #e8dfb0;
    border-radius: 6px;
    outline: none;
    font-family: inherit;
    background: #fffdf3;
    color: ${BRAND_INK};
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  textarea::placeholder { color: #8a8270; }
  textarea:focus {
    border-color: ${BRAND_INK};
    box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.40);
  }
  textarea:disabled { background: #f5efd0; color: #5c5546; }
  #pa-ta { flex: 1; min-height: 80px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
  .row.spread { justify-content: space-between; }
  .btn {
    border: 0;
    padding: 6px 12px;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    transition: background 100ms ease, color 100ms ease;
  }
  .btn.primary { background: ${BRAND_INK}; color: ${BRAND_CREAM}; }
  .btn.primary:hover { background: #2a2528; }
  .btn.primary:disabled { background: #8a8270; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: ${BRAND_INK}; }
  .btn.ghost:hover { background: rgba(32, 27, 33, 0.06); }
  .btn.ghost.stop,
  .btn.ghost.cancel { color: ${STATUS.error.fg}; }
  .btn.ghost.stop:hover,
  .btn.ghost.cancel:hover { background: ${STATUS.error.bg}; }
  .btn.icon { padding: 6px; display: inline-flex; align-items: center; }
  .btn.icon svg { width: 16px; height: 16px; display: block; }

  .header {
    font-size: 12px;
    font-weight: 500;
    color: ${BRAND_INK};
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  /* Spinner shown while a turn is in flight. The pseudo-element
     survives textContent updates so we don't have to re-insert
     the spinner each time the header copy changes. */
  .header.running::before {
    content: '';
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid ${STATUS.working.fg};
    border-top-color: transparent;
    border-radius: 50%;
    flex-shrink: 0;
    animation: pa-header-spin 0.9s linear infinite;
  }
  @keyframes pa-header-spin { to { transform: rotate(360deg); } }
  .log {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #e8dfb0;
    border-radius: 6px;
    padding: 8px;
    font-size: 12px;
    line-height: 1.45;
    background: #fffdf3;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msg { white-space: pre-wrap; word-break: break-word; color: ${BRAND_INK}; }
  .user-msg {
    white-space: pre-wrap;
    word-break: break-word;
    color: ${BRAND_INK};
    background: #f5efd0;
    border-left: 3px solid ${BRAND_INK};
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    align-self: flex-start;
    max-width: 100%;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: ${FONT_MONO};
    font-size: 11px;
    background: #f5efd0;
    color: ${BRAND_INK};
    border-radius: 4px;
    padding: 3px 6px;
    align-self: flex-start;
    max-width: 100%;
    border: 1px solid #e8dfb0;
  }
  .chip.err {
    background: ${STATUS.error.bg};
    color: ${STATUS.error.fg};
    border-color: ${STATUS.error.border};
  }
  .chip-name { font-weight: 600; }
  .chip-summary {
    color: #5c5546;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-status { margin-left: auto; opacity: 0.6; }
  .chip-status.ok { color: ${STATUS.landed.fg}; opacity: 1; }
  .chip-status.err { color: ${STATUS.error.fg}; opacity: 1; }
  .err-line { color: ${STATUS.error.fg}; font-size: 12px; white-space: pre-wrap; }
  .footer-note { font-size: 11px; color: #5c5546; font-family: ${FONT_MONO}; }

  /* Phase H — worktree lifecycle row. The text label on the left
     describes the current state; buttons on the right are the terminal
     actions. Default (working) uses the working palette; landed uses
     ready/landed; conflict uses error; discarded fades to muted. */
  .lifecycle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px;
    background: ${STATUS.working.bg};
    border: 1px solid ${STATUS.working.border};
    border-radius: 6px;
    font-size: 11px;
    color: ${STATUS.working.fg};
  }
  .lifecycle[hidden] { display: none; }
  .lifecycle.landed {
    background: ${STATUS.landed.bg};
    border-color: ${STATUS.landed.border};
    color: ${STATUS.landed.fg};
  }
  .lifecycle.discarded {
    background: ${STATUS.discarded.bg};
    border-color: ${STATUS.discarded.border};
    color: ${STATUS.discarded.fg};
  }
  .lifecycle.conflict {
    background: ${STATUS.error.bg};
    border-color: ${STATUS.error.border};
    color: ${STATUS.error.fg};
  }
  .lifecycle.busy { opacity: 0.7; }
  .lifecycle-label {
    flex: 1;
    min-width: 0;
    font-family: ${FONT_MONO};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lifecycle-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .lifecycle-btn { font-size: 11px; padding: 3px 8px; }
  .lifecycle-btn[hidden] { display: none; }

  .conflict-block {
    background: ${STATUS.error.bg};
    border-left: 3px solid ${STATUS.error.border};
    padding: 6px 8px;
    border-radius: 0 4px 4px 0;
    font-size: 11px;
    color: ${STATUS.error.fg};
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .conflict-block .conflict-title { font-weight: 600; }
  .conflict-block .conflict-file {
    font-family: ${FONT_MONO};
    color: ${STATUS.error.fg};
    opacity: 0.85;
  }

  /* Ask-form = agent is waiting on a clarifying answer. Mapped to the
     awaitingClarification palette so it visually echoes the same
     "needs reply" badge in the dock. */
  .ask-form {
    background: ${STATUS.awaitingClarification.bg};
    border: 1px solid ${STATUS.awaitingClarification.border};
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ask-question {
    font-weight: 600;
    color: ${STATUS.awaitingClarification.fg};
    font-size: 12px;
    white-space: pre-wrap;
  }
  .ask-options { display: flex; flex-wrap: wrap; gap: 4px; }
  .ask-option {
    background: ${BRAND_CREAM};
    border: 1px solid ${STATUS.awaitingClarification.border};
    color: ${STATUS.awaitingClarification.fg};
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: background 100ms ease;
  }
  .ask-option:hover { background: #fffdf3; box-shadow: 0 0 0 2px ${BRAND_GOLD}; }
  .ask-row { display: flex; gap: 4px; align-items: stretch; }
  .ask-input { font-size: 12px; min-height: 0; }
  .ask-resolved {
    background: ${STATUS.discarded.bg};
    border-left: 3px solid ${STATUS.discarded.border};
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ask-resolved .ask-question {
    color: ${STATUS.discarded.fg};
    font-size: 11px;
    font-weight: 500;
  }
  .ask-answer { color: ${BRAND_INK}; font-size: 12px; white-space: pre-wrap; }

  .follow {
    display: flex;
    gap: 6px;
    align-items: stretch;
    border-top: 1px solid #e8dfb0;
    padding-top: 8px;
  }
  #pa-follow-input { font-size: 12px; min-height: 0; }
  #pa-follow-send { white-space: nowrap; }

  /* --- Mini progress card --------------------------------------- */
  /* The minimized-while-running state. Same stream pane, condensed:
     the identity/breadcrumb header, lifecycle row, follow-up box and
     Stop button all collapse, leaving a status line, the last couple
     of activity rows, and a turns/cost footer with an Expand control.
     Driven by the parent toggling \`body.mini\`. */
  body.mini .header-block,
  body.mini #pa-lifecycle,
  body.mini .follow,
  body.mini #pa-stop { display: none; }
  body.mini .card { gap: 6px; padding: 10px; cursor: pointer; }
  body.mini .header {
    display: block;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Keep the running spinner inline with the (now block) header text. */
  body.mini .header.running::before { vertical-align: middle; margin-right: 6px; }
  body.mini .log {
    flex: none;
    max-height: 52px;
    overflow: hidden;
    gap: 4px;
  }
  /* Only the two most-recent activity rows stay visible — the tail of
     the transcript is the part that reads as "what's happening now". */
  body.mini .log > *:not(:nth-last-child(-n + 2)) { display: none; }
  body.mini .log > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  body.mini .ask-form,
  body.mini .ask-resolved,
  body.mini .conflict-block { display: none; }

  /* Terminal tint — the card border echoes the bubble palette so a
     finished run reads done/errored at a glance even while minimized. */
  body.mini[data-agent-state='done'] .card { border-color: ${STATUS.readyToLand.border}; }
  body.mini[data-agent-state='error'] .card { border-color: ${STATUS.error.border}; }

  /* Needs-input — the agent asked a question while we were minimized.
     Pulse the awaiting-clarification ring so it pulls attention; the
     card is click-to-expand to answer. */
  body.mini.needs-input .card {
    border-color: ${STATUS.awaitingClarification.border};
    animation: pa-card-pulse 1.6s ease-out infinite;
  }
  @keyframes pa-card-pulse {
    0%, 100% { box-shadow: 0 0 0 1px ${STATUS.awaitingClarification.border}, 0 10px 25px rgba(32, 27, 33, 0.18); }
    50%      { box-shadow: 0 0 0 4px ${STATUS.awaitingClarification.border}, 0 10px 25px rgba(32, 27, 33, 0.18); }
  }

  /* One-shot gold flash when a new tool activity lands while minimized,
     so a glance catches that the agent just did something. Skipped while
     'needs-input' owns the (infinite) pulse — that state is louder and
     takes precedence. The class is removed on animationend so the next
     activity re-triggers it. */
  body.mini.activity:not(.needs-input) .card {
    animation: pa-activity-pulse 0.45s ease-out;
  }
  @keyframes pa-activity-pulse {
    0%   { box-shadow: 0 0 0 3px ${BRAND_GOLD}, 0 10px 25px rgba(32, 27, 33, 0.18); }
    100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0), 0 10px 25px rgba(32, 27, 33, 0.18); }
  }

  @media (prefers-reduced-motion: reduce) {
    .meta, textarea, .btn, .ask-option { transition: none !important; }
    .header.running::before { animation: none; border-color: ${STATUS.working.fg}; }
    body.mini.needs-input .card { animation: none; box-shadow: 0 0 0 2px ${STATUS.awaitingClarification.border}, 0 10px 25px rgba(32, 27, 33, 0.18); }
    body.mini.activity .card { animation: none; }
  }
`;

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
  .meta {
    font-size: 11px;
    color: #5c5546;
    font-family: ${FONT_MONO};
    word-break: break-all;
    padding: 2px 4px;
    margin: -2px -4px;
    border-radius: 4px;
    transition: background 100ms ease, color 100ms ease;
    user-select: none;
  }
  .meta.clickable { cursor: pointer; }
  .meta.clickable:hover { background: #f5efd0; color: ${BRAND_INK}; }
  .meta.loading { opacity: 0.5; }
  .meta.ok { background: ${STATUS.landed.bg}; color: ${STATUS.landed.fg}; }
  .meta.err { background: ${STATUS.error.bg}; color: ${STATUS.error.fg}; }
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
`;

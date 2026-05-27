// SPDX-License-Identifier: Apache-2.0
/**
 * Inline CSS for the composer iframe (composerHTML in widget.ts).
 *
 * Extracted out of widget.ts to keep that file from sprawling further
 * and so the visual restyle has an obvious file to land in. The string
 * is templated straight into the iframe's <style> block via srcdoc, so
 * any `${…}` interpolation here must come from constants — no per-call
 * variables.
 *
 * Token values come from @pinagent/ui/tokens so the composer's look
 * stays in sync with the dock without a manual second-source.
 */
export const COMPOSER_STYLES = `
  html, body { margin: 0; padding: 0; background: transparent; height: 100%; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }
  body { color: #111827; }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
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
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
    padding: 2px 4px;
    margin: -2px -4px;
    border-radius: 4px;
    transition: background 100ms ease, color 100ms ease;
    user-select: none;
  }
  .meta.clickable { cursor: pointer; }
  .meta.clickable:hover { background: #f3f4f6; color: #111827; }
  .meta.loading { opacity: 0.5; }
  .meta.ok { background: #d1fae5; color: #065f46; }
  .meta.err { background: #fee2e2; color: #991b1b; }
  textarea {
    width: 100%;
    resize: none;
    padding: 8px;
    font-size: 13px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    outline: none;
    font-family: inherit;
    background: #fff;
    color: #111827;
  }
  textarea::placeholder { color: #9ca3af; }
  textarea:focus { border-color: #2563eb; }
  textarea:disabled { background: #f9fafb; color: #6b7280; }
  #pa-ta { flex: 1; min-height: 80px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
  .row.spread { justify-content: space-between; }
  .btn { border: 0; padding: 6px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; font-family: inherit; }
  .btn.primary { background: #2563eb; color: #fff; }
  .btn.primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #374151; }
  .btn.ghost.stop,
  .btn.ghost.cancel { color: #b91c1c; }
  .btn.ghost.stop:hover,
  .btn.ghost.cancel:hover { background: #fef2f2; }

  .header {
    font-size: 12px;
    font-weight: 500;
    color: #111827;
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
    border: 2px solid #2563eb;
    border-top-color: transparent;
    border-radius: 50%;
    flex-shrink: 0;
    animation: pa-header-spin 0.9s linear infinite;
  }
  @keyframes pa-header-spin { to { transform: rotate(360deg); } }
  .log {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px;
    font-size: 12px;
    line-height: 1.45;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msg { white-space: pre-wrap; word-break: break-word; color: #111827; }
  .user-msg {
    white-space: pre-wrap;
    word-break: break-word;
    color: #111827;
    background: #eef2ff;
    border-left: 3px solid #2563eb;
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    align-self: flex-start;
    max-width: 100%;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    background: #eef2ff;
    color: #1e3a8a;
    border-radius: 4px;
    padding: 3px 6px;
    align-self: flex-start;
    max-width: 100%;
  }
  .chip.err { background: #fee2e2; color: #991b1b; }
  .chip-name { font-weight: 600; }
  .chip-summary {
    color: #4338ca;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-status { margin-left: auto; opacity: 0.6; }
  .chip-status.ok { color: #047857; opacity: 1; }
  .chip-status.err { color: #b91c1c; opacity: 1; }
  .err-line { color: #b91c1c; font-size: 12px; white-space: pre-wrap; }
  .footer-note { font-size: 11px; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  /* Phase H — worktree lifecycle row, shown only when the conversation has
     an active worktree to act on. The text label on the left echoes the
     current state ("Working on pinagent/abc · 3 changes" while active,
     "Landed as 1a2b3c4d" after) and the buttons on the right give the
     terminal actions. */
  .lifecycle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px;
    background: #f5f3ff;
    border: 1px solid #ddd6fe;
    border-radius: 6px;
    font-size: 11px;
    color: #4c1d95;
  }
  .lifecycle[hidden] { display: none; }
  .lifecycle.landed { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
  .lifecycle.discarded { background: #f3f4f6; border-color: #e5e7eb; color: #6b7280; }
  .lifecycle.conflict { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  .lifecycle.busy { opacity: 0.7; }
  .lifecycle-label {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lifecycle-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .lifecycle-btn { font-size: 11px; padding: 3px 8px; }
  .lifecycle-btn[hidden] { display: none; }

  .conflict-block {
    background: #fef2f2;
    border-left: 3px solid #fca5a5;
    padding: 6px 8px;
    border-radius: 0 4px 4px 0;
    font-size: 11px;
    color: #991b1b;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .conflict-block .conflict-title { font-weight: 600; }
  .conflict-block .conflict-file {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #7f1d1d;
  }

  .ask-form {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ask-question { font-weight: 600; color: #92400e; font-size: 12px; white-space: pre-wrap; }
  .ask-options { display: flex; flex-wrap: wrap; gap: 4px; }
  .ask-option {
    background: #fff;
    border: 1px solid #fcd34d;
    color: #92400e;
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }
  .ask-option:hover { background: #fef3c7; }
  .ask-row { display: flex; gap: 4px; align-items: stretch; }
  .ask-input { font-size: 12px; min-height: 0; }
  .ask-resolved {
    background: #f3f4f6;
    border-left: 3px solid #9ca3af;
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ask-resolved .ask-question { color: #6b7280; font-size: 11px; font-weight: 500; }
  .ask-answer { color: #111827; font-size: 12px; white-space: pre-wrap; }

  .follow {
    display: flex;
    gap: 6px;
    align-items: stretch;
    border-top: 1px solid #f3f4f6;
    padding-top: 8px;
  }
  #pa-follow-input { font-size: 12px; min-height: 0; }
  #pa-follow-send { white-space: nowrap; }
`;

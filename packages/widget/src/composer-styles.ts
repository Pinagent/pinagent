// SPDX-License-Identifier: Apache-2.0
/**
 * Inline CSS for the composer iframe (composerHTML in widget.ts).
 *
 * Templated from the widget's dark theme (theme.ts → @pinagent/ui/tokens)
 * so the composer reads as the same brand as the dock's dark mode — deep
 * ink surfaces, cream text, gold accent, status colors tuned for dark.
 * Token values inline at module-load time; the string is dropped into the
 * iframe's <style> block via srcdoc.
 */
import { FONT_MONO, FONT_SANS } from '@pinagent/ui/tokens';
import { STATUS, THEME } from './theme';

export const COMPOSER_STYLES = `
  /* color-scheme: dark on the iframe document itself (not just the host's
     .pa-iframe element) so the UA canvas behind the transparent body is dark,
     not the default light. Without it a light frame bleeds out around the
     card's rounded corners and edges on a dark page. */
  html { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: transparent; height: 100%; }
  * { box-sizing: border-box; font-family: ${FONT_SANS}; }
  body { color: ${THEME.text}; }
  .card {
    background: ${THEME.surface};
    border: 1px solid ${THEME.border};
    border-radius: 10px;
    /* No drop shadow: the card fills the transparent iframe flush to its
       edges (width 100%, height calc(100% - 2px)), so any box-shadow is
       rectangular-clipped by the iframe bounds and renders as a hard-edged
       halo artifact rather than a soft shadow. The 1px border carries the
       card's separation from the page instead. */
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
    border-bottom: 1px solid ${THEME.border};
  }
  .hdr-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .hdr-row[hidden] { display: none; }

  /* Identity row: tag pill + quoted label. Pill uses a cream-tint fill so
     it reads as a highlighted code chip on the dark card and matches the
     same tag highlighted in the breadcrumb. The right padding reserves
     space for the drag handle that the parent positions inside the
     iframe's top-right corner. */
  .hdr-identity { padding-right: 28px; }
  .el-pill {
    display: inline-flex;
    align-items: center;
    font-family: ${FONT_MONO};
    font-size: 11px;
    font-weight: 600;
    background: ${THEME.chip};
    color: ${THEME.text};
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .el-label {
    font-size: 13px;
    font-weight: 500;
    color: ${THEME.text};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  /* Enclosing component name (data-pa-comp), e.g. "in <PriceCard>". Muted
     mono so it reads as source metadata next to the element label. */
  .el-comp {
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${THEME.text};
    opacity: 0.6;
    white-space: nowrap;
    flex-shrink: 0;
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
    background: ${THEME.accent};
    color: ${THEME.primaryFg};
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    cursor: help;
  }
  .el-extras:focus-visible { outline: 2px solid ${THEME.text}; outline-offset: 1px; }

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
    background: ${THEME.surface};
    border: 1px solid ${THEME.border};
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
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
    color: ${THEME.textMuted};
    margin-bottom: 6px;
  }
  .ex-row { display: flex; flex-direction: column; gap: 2px; padding: 5px 0; }
  .ex-row + .ex-row { border-top: 1px solid ${THEME.border}; }
  .ex-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .ex-pill {
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 600;
    background: ${THEME.chip};
    color: ${THEME.text};
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .ex-label {
    font-size: 12px;
    color: ${THEME.text};
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
    color: ${THEME.primaryFg};
    background: ${THEME.accent};
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .ex-loc {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: ${THEME.textMuted};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* File row (#pa-meta): code icon + path:line:col + external-link
     icon. The whole row is the click target for open-in-editor when
     loc resolved. Hover/loading/ok/err mirror the old .meta states. */
  .hdr-file {
    font-size: 11px;
    color: ${THEME.textMuted};
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
  .hdr-file.clickable:hover { background: ${THEME.hover}; color: ${THEME.text}; }
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
    color: ${THEME.textMuted};
    padding: 1px 6px;
    border-radius: 3px;
  }
  .bc-item.bc-selected {
    background: ${THEME.chip};
    color: ${THEME.text};
    font-weight: 600;
  }
  /* Pressable crumb — added by the composer wiring on a fresh, anchored
     pick so the user can re-focus the comment onto an ancestor. Hovering
     also flashes the matching node on the page (see wireComposerIframe). */
  .bc-item.bc-pressable {
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease;
  }
  .bc-item.bc-pressable:hover {
    background: ${THEME.chip};
    color: ${THEME.text};
  }
  .bc-item.bc-pressable:focus-visible {
    outline: 1px solid ${THEME.accent};
    outline-offset: 1px;
  }
  .bc-sep {
    color: ${THEME.textFaint};
    font-size: 12px;
    user-select: none;
  }

  /* --- Footer kbd hint --------------------------------------- */
  .footer-row { padding-top: 2px; }
  .kbd-hint {
    display: grid;
    grid-template-columns: repeat(2, auto);
    gap: 4px 12px;
    font-size: 11px;
    color: ${THEME.textMuted};
    font-family: ${FONT_MONO};
    user-select: none;
  }
  .kbd-hint-item {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
  }
  .kbd-hint kbd {
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${THEME.text};
    background: ${THEME.hoverStrong};
    border: 1px solid ${THEME.border};
    border-radius: 3px;
    padding: 0 4px;
    margin-right: 2px;
  }
  textarea {
    width: 100%;
    resize: none;
    padding: 8px;
    font-size: 13px;
    border: 1px solid ${THEME.border};
    border-radius: 6px;
    outline: none;
    font-family: inherit;
    background: ${THEME.base};
    color: ${THEME.text};
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  textarea::placeholder { color: ${THEME.textFaint}; }
  textarea:focus {
    border-color: ${THEME.text};
    box-shadow: 0 0 0 3px ${THEME.ring};
  }
  textarea:disabled { background: ${THEME.hover}; color: ${THEME.textMuted}; }
  #pa-ta { flex: 1; min-height: 80px; }

  /* --- @-mention file picker (mention-menu.ts) ------------------- */
  .pa-mention {
    position: fixed;
    z-index: 50;
    overflow-y: auto;
    background: ${THEME.surface};
    border: 1px solid ${THEME.border};
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
    padding: 4px;
    font-size: 12px;
  }
  .pa-mention[hidden] { display: none; }
  .pa-mention-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .pa-mention-row.is-active { background: ${THEME.hoverStrong}; }
  .pa-mention-icon { display: inline-flex; flex: 0 0 auto; color: ${THEME.textMuted}; }
  .pa-mention-icon svg { width: 13px; height: 13px; display: block; }
  .pa-mention-name {
    flex: 0 1 auto;
    color: ${THEME.text};
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pa-mention-dir {
    flex: 1 1 auto;
    min-width: 0;
    color: ${THEME.textMuted};
    font-family: ${FONT_MONO};
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
    direction: rtl;
  }
  .pa-mention-empty, .pa-mention-more {
    padding: 6px;
    color: ${THEME.textMuted};
    font-size: 11px;
  }
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
  .btn.primary { background: ${THEME.primary}; color: ${THEME.primaryFg}; }
  .btn.primary:hover { background: ${THEME.primaryHover}; }
  .btn.primary:disabled { background: ${THEME.hoverStrong}; color: ${THEME.textFaint}; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: ${THEME.text}; }
  .btn.ghost:hover { background: ${THEME.hover}; }
  .btn.ghost.stop,
  .btn.ghost.cancel { color: ${STATUS.error.fg}; }
  .btn.ghost.stop:hover,
  .btn.ghost.cancel:hover { background: ${STATUS.error.bg}; }
  .btn.icon { padding: 6px; display: inline-flex; align-items: center; }
  .btn.icon svg { width: 16px; height: 16px; display: block; }

  .header {
    font-size: 12px;
    font-weight: 500;
    color: ${THEME.text};
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
    border: 1px solid ${THEME.border};
    border-radius: 6px;
    padding: 8px;
    font-size: 12px;
    line-height: 1.45;
    background: ${THEME.base};
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  /* Loading gap: between submit and the first streamed event the log has
     no children. Collapse it (rather than show an empty bordered box) so
     the card hugs the header/footer until content lands. The iframe height
     is shrunk to match by Composer.refitStream() in widget.ts. */
  .log:empty { display: none; }
  .msg { white-space: pre-wrap; word-break: break-word; color: ${THEME.text}; }
  .user-msg {
    white-space: pre-wrap;
    word-break: break-word;
    color: ${THEME.text};
    background: ${THEME.hoverStrong};
    border-left: 3px solid ${THEME.accent};
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    align-self: flex-start;
    max-width: 100%;
  }
  /* Queued follow-up — typed (or a picked element added) while a turn was
     in flight, waiting its turn to send. Dashed + dimmed with a small
     "queued" tag; the de-pending on send drops both. */
  .user-msg.pending { opacity: 0.62; border-left-style: dashed; }
  .user-msg .queued-tag {
    display: inline-block;
    font-family: ${FONT_MONO};
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: ${THEME.textMuted};
    margin-right: 6px;
  }
  .user-msg:not(.pending) .queued-tag { display: none; }
  .user-msg .q-pill {
    display: inline-block;
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 600;
    background: ${THEME.chip};
    color: ${THEME.text};
    padding: 0 5px;
    border-radius: 3px;
    margin-right: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: ${FONT_MONO};
    font-size: 11px;
    background: ${THEME.hoverStrong};
    color: ${THEME.text};
    border-radius: 4px;
    padding: 3px 6px;
    align-self: flex-start;
    max-width: 100%;
    border: 1px solid ${THEME.border};
  }
  .chip.err {
    background: ${STATUS.error.bg};
    color: ${STATUS.error.fg};
    border-color: ${STATUS.error.border};
  }
  .chip-name { font-weight: 600; }
  .chip-summary {
    color: ${THEME.textMuted};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-status { margin-left: auto; opacity: 0.6; }
  .chip-status.ok { color: ${STATUS.landed.fg}; opacity: 1; }
  .chip-status.err { color: ${STATUS.error.fg}; opacity: 1; }
  /* Tool calls are collapsed into a quiet, opt-in group so the stream
     reads like a chat with the agent. The header is the click target;
     the chips stay hidden until the group is opened. */
  .tool-group { display: flex; flex-direction: column; gap: 6px; align-self: stretch; }
  .tool-group-head {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${THEME.textMuted};
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 2px 5px;
    margin: 0;
    cursor: pointer;
  }
  .tool-group-head:hover { background: ${THEME.hover}; color: ${THEME.text}; }
  .tool-group-chevron { display: inline-block; transition: transform 0.15s ease; }
  .tool-group.open .tool-group-chevron { transform: rotate(90deg); }
  .tool-group-items { display: none; flex-direction: column; gap: 6px; padding-left: 8px; }
  .tool-group.open .tool-group-items { display: flex; }
  .err-line { color: ${STATUS.error.fg}; font-size: 12px; white-space: pre-wrap; }
  .footer-note { font-size: 11px; color: ${THEME.textMuted}; font-family: ${FONT_MONO}; }

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
    background: ${THEME.surface};
    border: 1px solid ${STATUS.awaitingClarification.border};
    color: ${STATUS.awaitingClarification.fg};
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: background 100ms ease;
  }
  .ask-option:hover { background: ${THEME.hoverStrong}; box-shadow: 0 0 0 2px ${THEME.accent}; }
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
  .ask-answer { color: ${THEME.text}; font-size: 12px; white-space: pre-wrap; }

  .follow {
    display: flex;
    gap: 6px;
    align-items: stretch;
    border-top: 1px solid ${THEME.border};
    padding-top: 8px;
  }
  #pa-follow-input { font-size: 12px; min-height: 0; }
  #pa-follow-send { white-space: nowrap; }

  /* Attached-element draft pill — shown above the follow-up input when the
     user picks another element while the agent is idle, so they can type
     what they want changed before sending. */
  .attach-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: ${THEME.text};
    background: ${THEME.base};
    border: 1px solid ${THEME.border};
    border-radius: 6px;
    padding: 4px 6px;
    margin-bottom: 6px;
  }
  .attach-pill .q-pill {
    display: inline-block;
    flex-shrink: 0;
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 600;
    background: ${THEME.chip};
    color: ${THEME.text};
    padding: 0 5px;
    border-radius: 3px;
  }
  .attach-pill .attach-ref {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }
  .attach-pill .attach-x {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: ${THEME.text};
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0 2px;
  }
  .attach-pill .attach-x:hover { opacity: 0.6; }

  /* Enclosing-component / loop-instance context line (from #166), under
     the stream header. sc-comp mirrors the header-block's component
     chip, so it's hidden when expanded (the block already shows it) and
     only earns its keep in the mini card. sc-instance shows in both
     states — the loop instance isn't surfaced anywhere else. */
  .stream-context {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${THEME.text};
    opacity: 0.6;
  }
  .stream-context[hidden] { display: none; }
  .stream-context > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  body:not(.mini) .sc-comp { display: none; }
  /* Hide the whole line when expanded if the only thing it could show
     (the component) is hidden — i.e. there's no loop instance. */
  body:not(.mini) .stream-context:not(:has(.sc-instance)) { display: none; }
  /* Dot separator between the two spans, only when both render (mini). */
  body.mini .sc-comp + .sc-instance::before { content: '·'; margin-right: 6px; opacity: 0.6; }

  /* --- Minimal single-line bar (viewState: 'minimal') ----------- */
  /* The default state right after spawn. Everything else in the stream
     pane collapses, leaving one row: a status indicator, an ellipsized
     activity label, and the state-driven action cluster. Driven by the
     parent toggling \`body.mini\` (set whenever the composer isn't
     expanded). The bar is hidden in the expanded view. */
  .mini-bar { display: none; }
  body.mini .header,
  body.mini .header-block,
  body.mini .stream-context,
  body.mini #pa-lifecycle,
  body.mini .log,
  body.mini .follow,
  body.mini #pa-stream-footer-row,
  body.mini .ask-form,
  body.mini .ask-resolved,
  body.mini .conflict-block { display: none; }
  /* Unanchored chat (opened from the running-agents tray): no picked
     element, so drop the element-identity header (tag pill / file row /
     breadcrumb). The stream pane keeps its own status header. */
  body.unanchored .header-block { display: none; }
  /* Compact card: tight vertical padding, and extra left padding to clear
     the leading drag grip (a body-level overlay positioned by reposition()
     so the minimized bar can be dragged just like the expanded composer). */
  body.mini .card { gap: 0; padding: 4px 8px 4px 30px; cursor: pointer; justify-content: center; }
  body.mini .mini-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .mini-label {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    color: ${THEME.text};
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Status indicator — exactly one child shows, selected by the agent
     state mirrored onto the body. Lives only inside the (mini-only) bar. */
  .mini-status {
    position: relative;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .mini-status > * { display: none; }
  .ms-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid ${STATUS.working.fg};
    border-top-color: transparent;
    border-radius: 50%;
    animation: pa-mini-spin 0.9s linear infinite;
  }
  @keyframes pa-mini-spin { to { transform: rotate(360deg); } }
  .ms-check { width: 14px; height: 14px; }
  .ms-check path {
    stroke: ${STATUS.readyToLand.fg};
    stroke-width: 2.5;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 22;
    stroke-dashoffset: 22;
  }
  @keyframes pa-mini-check { to { stroke-dashoffset: 0; } }
  .ms-x { color: ${STATUS.error.fg}; font-size: 13px; font-weight: 700; line-height: 1; }
  .ms-alert { color: ${STATUS.awaitingClarification.fg}; font-size: 11px; line-height: 1; }
  body[data-agent-state='pending'] .ms-spinner,
  body[data-agent-state='running'] .ms-spinner { display: block; }
  body[data-agent-state='done'] .ms-check { display: block; }
  body[data-agent-state='done'] .ms-check path { animation: pa-mini-check 0.45s ease forwards; }
  body[data-agent-state='error'] .ms-x { display: block; }
  /* Needs-input wins over the running spinner — the agent is blocked. */
  body.needs-input .ms-spinner { display: none; }
  body.needs-input .ms-alert { display: block; }

  /* Action cluster. Visibility per state is CSS-only off the body state:
     stop while running (unless blocked on input), answer when blocked,
     collapse + cancel always. */
  .mini-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .mini-icon-btn {
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
    transition: background 100ms ease, color 100ms ease;
  }
  .mini-icon-btn:hover { background: ${THEME.hover}; }
  .mini-icon-btn svg { width: 15px; height: 15px; display: block; }
  .mini-icon-btn.danger { color: ${STATUS.error.fg}; }
  .mini-icon-btn.danger:hover { background: ${STATUS.error.bg}; }
  #pa-mini-stop, #pa-mini-answer { display: none; }
  body[data-agent-state='pending'] #pa-mini-stop,
  body[data-agent-state='running'] #pa-mini-stop { display: inline-flex; }
  body.needs-input #pa-mini-stop { display: none; }
  body.needs-input #pa-mini-answer { display: inline-flex; }

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
  /* Pulse the brighter foreground tone (not the muted .border) so the
     ring reads loud against a dark host page and pulls attention. */
  @keyframes pa-card-pulse {
    0%, 100% { box-shadow: 0 0 0 1px ${STATUS.awaitingClarification.fg}; }
    50%      { box-shadow: 0 0 0 4px ${STATUS.awaitingClarification.fg}; }
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
    0%   { box-shadow: 0 0 0 3px ${THEME.accent}; }
    100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .meta, textarea, .btn, .ask-option, .mini-icon-btn { transition: none !important; }
    .header.running::before { animation: none; border-color: ${STATUS.working.fg}; }
    .ms-spinner { animation: none; }
    /* Snap the check to drawn rather than animating the stroke. */
    body[data-agent-state='done'] .ms-check path { animation: none; stroke-dashoffset: 0; }
    body.mini.needs-input .card { animation: none; box-shadow: 0 0 0 2px ${STATUS.awaitingClarification.border}; }
    body.mini.activity .card { animation: none; }
  }
`;

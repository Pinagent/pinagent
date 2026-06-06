// SPDX-License-Identifier: Apache-2.0
import { COMPOSER_STYLES } from './composer-styles';
import type { PaLoc } from './selector';
import type { ComposerMeta } from './types';

const ICON_CODE = `<svg class="hdr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

const ICON_EXTERNAL = `<svg class="hdr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

const ICON_SIDEBAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>`;

// Action-icon set shared by the single-line minimal bar (and mirrored on
// the floating bubble in composer.ts). Stop = interrupt the run; X = cancel
// (interrupt + close); comment = the agent is waiting on an answer, click to
// expand; pick = add another element to this conversation; dot = collapse to
// the floating bubble.
export const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`;
export const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
export const ICON_COMMENT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
const ICON_PICK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`;
const ICON_DOT = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>`;

/**
 * The single-line minimal bar — `viewState === 'minimal'`. A status
 * indicator (spinner / drawn green check / alert / ✗, driven purely by
 * `body[data-agent-state]` + `body.needs-input`), an ellipsized activity
 * label, and the state-driven action cluster. Lives inside the stream pane;
 * shown only when `body.mini` is set (everything else in the pane hides).
 */
const MINI_STATUS =
  `<span class="mini-status" id="pa-mini-status" aria-hidden="true">` +
  `<span class="ms-spinner"></span>` +
  `<svg class="ms-check" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-10"/></svg>` +
  `<span class="ms-x">✕</span>` +
  `<span class="ms-alert">▲</span>` +
  `</span>`;

const MINI_BAR =
  `<div class="mini-bar" id="pa-mini-bar">` +
  MINI_STATUS +
  `<span class="mini-label" id="pa-mini-label">Working…</span>` +
  `<div class="mini-actions">` +
  `<button class="mini-icon-btn" id="pa-mini-stop" type="button" title="Stop the agent" aria-label="Stop the agent">${ICON_STOP}</button>` +
  `<button class="mini-icon-btn" id="pa-mini-answer" type="button" title="Answer the agent" aria-label="Answer the agent">${ICON_COMMENT}</button>` +
  `<button class="mini-icon-btn" id="pa-mini-collapse" type="button" title="Collapse to a dot" aria-label="Collapse to a dot">${ICON_DOT}</button>` +
  `<button class="mini-icon-btn danger" id="pa-mini-cancel" type="button" title="Cancel — stop and dismiss" aria-label="Cancel — stop and dismiss">${ICON_X}</button>` +
  `</div>` +
  `</div>`;

export function composerHTML(meta: ComposerMeta): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${COMPOSER_STYLES}</style></head><body>
  <div class="card">
    ${renderHeader(meta, esc)}

    <div class="pane" id="pa-composer-pane">
      <textarea id="pa-ta" placeholder="Describe the change you want…"></textarea>
      <div class="row spread footer-row">
        <span class="kbd-hint">
          <span class="kbd-hint-item"><kbd>↵</kbd> submit</span>
          <span class="kbd-hint-item"><kbd>⇧↵</kbd> newline</span>
          <span class="kbd-hint-item"><kbd>esc</kbd> cancel</span>
          <span class="kbd-hint-item"><kbd>c</kbd> comment</span>
        </span>
        <div class="row" style="gap:8px;">
          <button class="btn ghost" id="pa-cancel" type="button">Cancel</button>
          <button class="btn primary" id="pa-submit" type="button" disabled>Submit</button>
        </div>
      </div>
    </div>

    <div class="pane" id="pa-stream-pane" hidden>
      ${MINI_BAR}
      <div class="header" id="pa-stream-header">Working…</div>
      <div class="stream-context" id="pa-stream-context" hidden></div>
      <div class="lifecycle" id="pa-lifecycle" hidden>
        <span class="lifecycle-label" id="pa-lifecycle-label"></span>
        <div class="lifecycle-actions">
          <button class="btn lifecycle-btn primary" id="pa-land" type="button" hidden>Land</button>
          <button class="btn lifecycle-btn ghost" id="pa-discard" type="button" hidden>Discard</button>
        </div>
      </div>
      <div class="log" id="pa-stream-log"></div>
      <div class="follow">
        <textarea id="pa-follow-input" rows="2" placeholder="Working…" disabled></textarea>
        <button class="btn primary" id="pa-follow-send" type="button" disabled>Send</button>
      </div>
      <div class="row spread" id="pa-stream-footer-row">
        <span class="footer-note" id="pa-stream-footer"></span>
        <div class="row" style="gap:6px;">
          <button class="btn ghost icon" id="pa-add-node" type="button" title="Add another element to this conversation" aria-label="Add another element to this conversation">${ICON_PICK}</button>
          <button class="btn ghost icon" id="pa-open-dock" type="button" title="Open in dock" aria-label="Open conversation in dock" hidden>${ICON_SIDEBAR}</button>
          <button class="btn ghost stop" id="pa-stop" type="button" hidden>Stop</button>
          <button class="btn ghost" id="pa-dismiss" type="button">Minimize</button>
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

function renderHeader(meta: ComposerMeta, esc: (s: string) => string): string {
  // Identity row: the picked element's tag pill + (optionally) a
  // quoted label. The pill uses the "selected" ink-on-cream palette
  // so it visually matches the same tag in the breadcrumb below. When
  // the user accumulated extras with Cmd/Ctrl-click, an "+N" badge
  // tags along; hovering it asks the parent to flash highlights on
  // the extras so the user remembers what they picked.
  const extraBadge =
    meta.extraCount > 0
      ? `<span class="el-extras-wrap">` +
        `<span class="el-extras" id="pa-extras" tabindex="0" role="button" aria-label="${meta.extraCount} more elements selected; hover to list them">+${meta.extraCount}</span>` +
        renderExtrasPopover(meta, esc) +
        `</span>`
      : '';
  const identity =
    `<div class="hdr-row hdr-identity">` +
    `<span class="el-pill">&lt;${esc(meta.tag)}&gt;</span>` +
    (meta.label ? `<span class="el-label">"${esc(meta.label)}"</span>` : '') +
    // Enclosing component (from data-pa-comp), when instrumented — tells
    // the user (and, via the payload, the agent) which component owns the
    // picked element, e.g. `in <PriceCard>`.
    (meta.component ? `<span class="el-comp">in &lt;${esc(meta.component)}&gt;</span>` : '') +
    extraBadge +
    `</div>`;

  // File row: only rendered when data-pa-loc resolved. Hosts the
  // open-in-editor click target — see `wireComposerIframe` for the
  // POST handler. Keeps the same `#pa-meta` id so existing wiring
  // grabs the right node.
  const fileRow = meta.loc
    ? `<div class="hdr-row hdr-file" id="pa-meta">${ICON_CODE}<span class="hdr-file-text">${esc(`${meta.loc.file}:${meta.loc.line}:${meta.loc.col}`)}</span>${ICON_EXTERNAL}</div>`
    : `<div class="hdr-row hdr-file" id="pa-meta" hidden></div>`;

  // Breadcrumb: last item is the picked element and gets the
  // selected style. Items collapse with `>` separators between them.
  // Show at most the last 4 hops so a deep tree doesn't blow up the
  // header width. Each crumb is stamped with `data-bc-up` — how many
  // `parentElement` hops from the picked element it represents (0 = the
  // element itself, the last crumb). The composer wiring uses that to
  // highlight the matching page node on hover and re-focus onto it on
  // click; see `wireComposerIframe`.
  const crumbs = meta.breadcrumbs.slice(-4);
  const breadcrumb =
    `<div class="hdr-row hdr-bc">` +
    crumbs
      .map((tag, i) => {
        const isLast = i === crumbs.length - 1;
        const up = crumbs.length - 1 - i;
        const cls = isLast ? 'bc-item bc-selected' : 'bc-item';
        return (
          `<span class="${cls}" data-bc-up="${up}">&lt;${esc(tag)}&gt;</span>` +
          (isLast ? '' : `<span class="bc-sep">›</span>`)
        );
      })
      .join('') +
    `</div>`;

  return `<div class="header-block">${identity}${fileRow}${breadcrumb}</div>`;
}

/**
 * Hover/focus popover anchored to the "+N" badge. Lists every selected
 * element — the primary pick (marked) followed by each Cmd/Ctrl-click
 * extra — so the user can see what's bundled into this comment without
 * leaving the composer. Shown via CSS `:hover`/`:focus-within` on the
 * wrapper; the page-outline flash on the underlying elements still
 * fires from the badge's mouseenter (see `wireComposerIframe`).
 */
function renderExtrasPopover(meta: ComposerMeta, esc: (s: string) => string): string {
  const row = (
    tag: string,
    label: string | null,
    loc: PaLoc | null,
    marker: 'picked' | number,
  ): string =>
    `<div class="ex-row">` +
    `<div class="ex-head">` +
    (typeof marker === 'number' ? `<span class="ex-num">${marker}</span>` : '') +
    `<span class="ex-pill">&lt;${esc(tag)}&gt;</span>` +
    (label ? `<span class="ex-label">"${esc(label)}"</span>` : '') +
    (marker === 'picked' ? `<span class="ex-tag-primary">picked</span>` : '') +
    `</div>` +
    (loc ? `<div class="ex-loc">${esc(`${loc.file}:${loc.line}:${loc.col}`)}</div>` : '') +
    `</div>`;
  const total = meta.extraCount + 1;
  return (
    `<div class="el-extras-pop" id="pa-extras-pop" role="tooltip">` +
    `<div class="ex-title">${total} elements selected</div>` +
    row(meta.tag, meta.label, meta.loc, 'picked') +
    // Extras are numbered 1-based in selection order, matching the badges
    // drawn on the page while multi-picking and on the "+N" hover flash.
    meta.extras.map((e, i) => row(e.tag, e.label, e.loc, i + 1)).join('') +
    `</div>`
  );
}

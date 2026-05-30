// SPDX-License-Identifier: Apache-2.0
import { IFRAME_W, MINI_H, STREAM_H } from '../constants';
import type { AgentState } from '../types';

/**
 * Story scaffolding that mirrors how `mount()` (widget.ts) renders the real
 * widget, so stories exercise the shipped DOM + CSS rather than a copy.
 *
 *  - `mountShadow` reproduces the closed-shadow-root host + injected
 *    `STYLES` used for the FAB / picker chrome (here `open` so Storybook's
 *    inspector can see in).
 *  - `mountComposerFrame` reproduces the same-origin composer iframe whose
 *    document is `composerHTML()` with `COMPOSER_STYLES` inlined, then
 *    drives the CSS-only state knobs (`body.mini`, `body[data-agent-state]`,
 *    `body.needs-input`) that the live composer toggles at runtime.
 */

export function mountShadow(
  styles: string,
  build: (root: ShadowRoot) => void,
  size: { width?: string; height?: string } = {},
): HTMLElement {
  const host = document.createElement('div');
  // Give the fixed-positioned chrome (FAB, outline, hint) a local box to
  // anchor to so it doesn't fly to the viewport corner of the Storybook
  // canvas. Stories that depict fixed elements override their `position`
  // to `absolute` so they sit inside this box.
  host.style.position = 'relative';
  host.style.width = size.width ?? '320px';
  host.style.height = size.height ?? '180px';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  root.appendChild(style);
  build(root);
  return host;
}

export interface ComposerFrameOptions {
  /** Which pane is showing. `compose` = pre-submit form; `stream` = post-submit. */
  pane?: 'compose' | 'stream';
  /** Collapse the stream pane to the single-line mini bar (`body.mini`). */
  mini?: boolean;
  /** Drives the spinner/check/error indicators via `body[data-agent-state]`. */
  agentState?: AgentState;
  /** Agent is blocked on an `ask_user` answer (`body.needs-input`). */
  needsInput?: boolean;
  /** Mini-bar / stream-header activity label. */
  label?: string;
}

/**
 * Render `composerHTML(meta)` into a sized iframe and apply the runtime
 * state knobs once it loads. Returns a wrapper element Storybook can mount.
 */
export function mountComposerFrame(srcdoc: string, opts: ComposerFrameOptions = {}): HTMLElement {
  const {
    pane = 'compose',
    mini = false,
    agentState = 'running',
    needsInput = false,
    label,
  } = opts;

  const wrap = document.createElement('div');
  wrap.style.width = `${IFRAME_W}px`;
  const iframe = document.createElement('iframe');
  iframe.style.width = `${IFRAME_W}px`;
  iframe.style.height = `${mini ? MINI_H : STREAM_H}px`;
  iframe.style.border = '0';
  iframe.style.borderRadius = '14px';
  iframe.style.boxShadow = '0 18px 48px rgba(32, 27, 33, 0.22)';
  iframe.style.background = 'transparent';
  iframe.srcdoc = srcdoc;

  iframe.addEventListener('load', () => {
    const idoc = iframe.contentDocument;
    if (!idoc?.body) return;
    const body = idoc.body;
    const composePane = idoc.getElementById('pa-composer-pane');
    const streamPane = idoc.getElementById('pa-stream-pane');

    if (pane === 'stream') {
      composePane?.setAttribute('hidden', '');
      streamPane?.removeAttribute('hidden');
      body.classList.toggle('mini', mini);
      body.classList.toggle('needs-input', needsInput);
      body.dataset.agentState = agentState;
      if (label) {
        const miniLabel = idoc.getElementById('pa-mini-label');
        const header = idoc.getElementById('pa-stream-header');
        if (miniLabel) miniLabel.textContent = label;
        if (header) header.textContent = label;
      }
    }
  });

  wrap.appendChild(iframe);
  return wrap;
}

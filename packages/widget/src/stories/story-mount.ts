// SPDX-License-Identifier: Apache-2.0
import { IFRAME_W } from '../constants';
import type { AgentState } from '../types';

/**
 * Story scaffolding that mirrors how `mount()` (widget.ts) renders the real
 * widget, so stories exercise the shipped DOM + CSS rather than a copy.
 *
 *  - `mountChrome` renders the FAB / picker chrome from the real `STYLES`
 *    into the *light* DOM. The live widget uses a closed shadow root, but a
 *    shadow root can only be picked as one unit — `document.elementFromPoint`
 *    returns the host — so the dogfood picker can't reach individual elements
 *    inside it. Light DOM keeps the styles class-based and visually identical
 *    while letting a pick (and `↑/↓` ancestry walk) target a specific element
 *    tagged with `data-pa-loc`.
 *  - `mountComposer` lifts `composerHTML()`'s body markup into the light DOM
 *    and rewrites its `html`/`body` selectors (incl. the CSS-only state knobs
 *    `body.mini`, `body[data-agent-state]`, `body.needs-input`) onto a
 *    `.pa-composer-root`. The live composer uses an iframe for those knobs,
 *    but the picker can't pierce an iframe, so light DOM is what makes the
 *    individual controls pickable.
 */

/**
 * Render `styles` + `build(host)` into a light-DOM box. The widget's
 * `STYLES` are class-based (`.fab`, `.outline`, `.hint`, `.toast`), so
 * injecting them at document scope styles only the story's own elements; the
 * lone shadow-specific rule, `:host { all: initial }`, is isolation we don't
 * need in the controlled Storybook canvas, and its `color-scheme: dark` is
 * set on the host box directly.
 */
export function mountChrome(
  styles: string,
  build: (host: HTMLElement) => void,
  size: { width?: string; height?: string } = {},
): HTMLElement {
  ensureChromeStyle(styles);
  const host = document.createElement('div');
  host.className = 'pa-story-chrome';
  // Give the fixed-positioned chrome (FAB, outline, hint) a local box to
  // anchor to so it doesn't fly to the viewport corner of the Storybook
  // canvas. Stories that depict fixed elements override their `position`
  // to `absolute` so they sit inside this box.
  host.style.position = 'relative';
  // color-scheme normally rides in on `:host`; set it here since we're not in
  // a shadow root (keeps form controls / scrollbars on dark UA theming).
  host.style.colorScheme = 'dark';
  host.style.width = size.width ?? '320px';
  host.style.height = size.height ?? '180px';
  build(host);
  return host;
}

/** Inject the widget `STYLES` into the canvas head once for all chrome stories. */
function ensureChromeStyle(styles: string): void {
  if (document.getElementById('pa-story-chrome-style')) return;
  const style = document.createElement('style');
  style.id = 'pa-story-chrome-style';
  style.textContent = styles;
  document.head.appendChild(style);
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
 * Render `composerHTML(meta)` into the *light* DOM and apply the runtime state
 * knobs synchronously. Returns a root element Storybook can mount.
 *
 * The live composer lives in a same-origin iframe so its `body.*` /
 * `body[data-agent-state]` selectors and dark-canvas isolation work — but the
 * picker can't pierce an iframe, so a dogfood pick could only ever grab the
 * whole panel (the earlier overlay approach). Here we instead lift the
 * composer's body markup into a light-DOM root and rewrite the stylesheet's
 * `html`/`body` selectors onto that root, so the same CSS drives the same
 * states while every control (textarea, Submit, header, …) is individually
 * pickable. Key controls get a `data-pa-loc` so a pick lands on the composer
 * source.
 */
export function mountComposer(srcdoc: string, opts: ComposerFrameOptions = {}): HTMLElement {
  const {
    pane = 'compose',
    mini = false,
    agentState = 'running',
    needsInput = false,
    label,
  } = opts;

  const parsed = new DOMParser().parseFromString(srcdoc, 'text/html');
  ensureComposerStyle(parsed.querySelector('style')?.textContent ?? '');

  // Light-DOM stand-in for the iframe `<body>`: it carries the same state
  // classes the live composer toggles on its body, and the rewritten CSS keys
  // off `.pa-composer-root` instead of `body`/`html`.
  const root = document.createElement('div');
  root.className = 'pa-composer-root';
  root.style.width = `${IFRAME_W}px`;
  // The `html, body { height: 100% }` rule (rewritten onto the root) would
  // collapse against the height-less canvas; let the card size the root.
  root.style.height = 'auto';
  while (parsed.body.firstChild) root.appendChild(parsed.body.firstChild);

  if (pane === 'stream') {
    root.querySelector('#pa-composer-pane')?.setAttribute('hidden', '');
    root.querySelector('#pa-stream-pane')?.removeAttribute('hidden');
    root.classList.toggle('mini', mini);
    root.classList.toggle('needs-input', needsInput);
    root.dataset.agentState = agentState;
    if (label) {
      const miniLabel = root.querySelector('#pa-mini-label');
      const header = root.querySelector('#pa-stream-header');
      if (miniLabel) miniLabel.textContent = label;
      if (header) header.textContent = label;
    }
  }

  // Best-effort dogfood anchors so a pick on a specific control lands on the
  // composer source rather than just a CSS selector.
  for (const sel of ['#pa-ta', '#pa-submit', '#pa-cancel', '.header', '.card']) {
    root.querySelector(sel)?.setAttribute('data-pa-loc', COMPOSER_PICK_LOC);
  }

  return root;
}

/** Source anchor handed to the dogfood picker for composer elements. */
const COMPOSER_PICK_LOC = 'src/composer-html.ts:1:1';

/**
 * Inject the composer CSS once, rewritten from the iframe's `html`/`body`
 * selectors onto the light-DOM `.pa-composer-root`. All composer stories share
 * the same `COMPOSER_STYLES`, so one injection covers them; idempotent.
 */
function ensureComposerStyle(styleText: string): void {
  if (document.getElementById('pa-story-composer-style')) return;
  const scoped = styleText
    .replace(/\bhtml\b/g, '.pa-composer-root')
    .replace(/\bbody\b/g, '.pa-composer-root');
  const style = document.createElement('style');
  style.id = 'pa-story-composer-style';
  style.textContent = scoped;
  document.head.appendChild(style);
}

// SPDX-License-Identifier: Apache-2.0
import { IFRAME_W, MINI_H, STREAM_H } from '../constants';
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
 *  - `mountComposerFrame` reproduces the same-origin composer iframe whose
 *    document is `composerHTML()` with `COMPOSER_STYLES` inlined, then
 *    drives the CSS-only state knobs (`body.mini`, `body[data-agent-state]`,
 *    `body.needs-input`) that the live composer toggles at runtime. The
 *    composer needs the iframe for those body-level knobs, so it's made
 *    pickable via the canvas overlay below rather than light DOM.
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
  // Anchor box for the dogfood pick target overlaid below.
  wrap.style.position = 'relative';
  const iframe = document.createElement('iframe');
  iframe.style.width = `${IFRAME_W}px`;
  iframe.style.height = `${mini ? MINI_H : STREAM_H}px`;
  // Block so the wrap collapses to the iframe's exact box (no inline
  // descender gap) and the absolutely-positioned pick target lines up.
  iframe.style.display = 'block';
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

  // Dogfood pickability. The composer renders inside an iframe (for the
  // body-level state knobs above + dark-canvas isolation), which the picker —
  // running in the canvas document — can't pierce: clicks land inside the
  // iframe instead of the picker. Overlay a transparent pick target in the
  // *canvas* so the panel is selectable as one element. It stays inert
  // (`pointer-events: none`) until the picker arms — the widget toggles
  // `pa-picking` on the canvas <html> — so plain Storybook (no widget, class
  // never set) and live composer interaction (typing in the textarea) are
  // untouched. The `data-pa-loc` lands a dogfood pick on the composer source.
  ensurePickTargetStyle();
  const pickTarget = document.createElement('div');
  pickTarget.className = 'pa-story-pick-target';
  pickTarget.dataset.paLoc = COMPOSER_PICK_LOC;
  wrap.appendChild(pickTarget);

  return wrap;
}

/** Source anchor handed to the dogfood picker for the composer panel. */
const COMPOSER_PICK_LOC = 'src/composer-html.ts:1:1';

/**
 * Inject the pick-target CSS once: inert by default, interactive only while
 * the widget's picker is active (`html.pa-picking`). Idempotent across the
 * many composer stories that mount in one preview document.
 */
function ensurePickTargetStyle(): void {
  if (document.getElementById('pa-story-pick-style')) return;
  const style = document.createElement('style');
  style.id = 'pa-story-pick-style';
  style.textContent =
    '.pa-story-pick-target{position:absolute;inset:0;pointer-events:none}' +
    'html.pa-picking .pa-story-pick-target{pointer-events:auto}';
  document.head.appendChild(style);
}

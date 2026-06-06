// SPDX-License-Identifier: Apache-2.0

/**
 * Dogfood-only: relay the widget's pick hotkey from the Storybook *manager*
 * into the *preview* iframe.
 *
 * The dogfood widget (`PINAGENT_DOGFOOD=1`, see `main.ts`) is injected into
 * the preview iframe, so its own `keydown` listener (widget.ts) only fires
 * when focus is inside the story canvas. Whenever focus sits in the Storybook
 * manager chrome (sidebar, toolbar, addon panels) the manager owns the
 * keyboard and the pick hotkey never reaches the widget — that's the
 * "Storybook takes over" symptom. keydown events don't cross frame
 * boundaries, so the two listeners are mutually exclusive: this one fires
 * only when the manager has focus, the widget's only when the canvas does.
 *
 * We mirror the existing dock→host relay (widget.ts: the
 * `{ source: 'pinagent-dock', type: 'enter-picker' }` message handler): on
 * the pick hotkey, postMessage that message to the preview iframe, which the
 * widget already listens for. No widget change needed.
 *
 * Gated on the same env var as the rest of the dogfood wiring via a global
 * the manager head injects (`main.ts` `managerHead`), so this is a no-op in
 * normal Storybook and in the CI `build-storybook` gate.
 */

// Default widget pick hotkey — keep in sync with `resolveHotkey()` in
// widget/src/config.ts (no `__pinagentHotkey` override exists in Storybook).
const HOTKEY = 'c';
// Stable id Storybook gives the preview iframe in the manager DOM.
const PREVIEW_IFRAME_ID = 'storybook-preview-iframe';

const dogfood = (window as unknown as { __PINAGENT_DOGFOOD__?: boolean }).__PINAGENT_DOGFOOD__;

if (dogfood) {
  window.addEventListener(
    'keydown',
    (e) => {
      // Mirror widget keyboard.ts `shouldIgnoreHotkey`: bare key only, and
      // never while typing into a field.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== HOTKEY) return;
      const t = e.target as (Element & { isContentEditable?: boolean }) | null;
      if (t) {
        if (t.isContentEditable) return;
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      const iframe = document.getElementById(PREVIEW_IFRAME_ID) as HTMLIFrameElement | null;
      const win = iframe?.contentWindow;
      if (!win) return;
      e.preventDefault();
      // Same-origin, but the widget validates by `source`/`type` not origin,
      // so a `'*'` target is fine and survives Storybook's iframe origin.
      win.postMessage({ source: 'pinagent-dock', type: 'enter-picker' }, '*');
    },
    { capture: true },
  );
}

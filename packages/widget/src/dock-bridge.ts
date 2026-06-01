// SPDX-License-Identifier: Apache-2.0
/**
 * Host-side helpers for talking to the dock iframe the host bridge mounted
 * as a sibling. Keystrokes inside one of the widget's own iframes (the
 * composer) never reach the host document, so anything that wants to drive
 * the dock from inside an iframe routes through here instead.
 *
 *   - `openConversationInDock` — jump the dock to a conversation. Posted by
 *     the running-agents tray ("Open") and the composer's anchor-lost dot;
 *     handled by the dock's `useOpenConversationBridge`.
 *   - `toggleDock` — open/close the dock. Mirrors the host bridge's own
 *     Cmd+Shift+P keydown (see vite-plugin/index.ts) so the shortcut also
 *     works while focus is inside a spawned agent's composer iframe.
 *   - `setDockHidden` — hide/show the dock iframe element from the host
 *     side while the element picker is active, so a fullscreen/floating
 *     dock doesn't occlude the page the user is trying to pick from. We
 *     toggle the iframe's visibility rather than closing the dock so its
 *     React tree (and any unsaved reply draft) stays mounted.
 */
const DOCK_IFRAME_ID = '__pinagent-dock';

function getDockIframe(): HTMLIFrameElement | null {
  const el = document.getElementById(DOCK_IFRAME_ID);
  return el instanceof HTMLIFrameElement ? el : null;
}

export function openConversationInDock(feedbackId: string): void {
  const iframe = getDockIframe();
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(
      { source: 'pinagent-host', type: 'open-conversation', feedbackId },
      '*',
    );
  }
}

export function toggleDock(): void {
  const iframe = getDockIframe();
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ source: 'pinagent-host', type: 'toggle-dock' }, '*');
  }
}

export function setDockHidden(hidden: boolean): void {
  // `visibility: hidden` both blanks the iframe and stops it receiving
  // pointer events, so picker clicks pass straight through to the page.
  // The host bridge independently manages `pointer-events`; leave that
  // alone and restore the empty string so its toggling resumes on exit.
  const iframe = getDockIframe();
  if (iframe) iframe.style.visibility = hidden ? 'hidden' : '';
}

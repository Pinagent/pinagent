// SPDX-License-Identifier: Apache-2.0
/**
 * Single source of truth for the host→dock `open-conversation` postMessage
 * frame. Both the running-agents tray ("Open" button) and the composer's
 * anchor-lost dot post the same frame to the dock iframe the host bridge
 * mounted as a sibling — see the dock's `useOpenConversationBridge`.
 */
const DOCK_IFRAME_ID = '__pinagent-dock';

export function openConversationInDock(feedbackId: string): void {
  const iframe = document.getElementById(DOCK_IFRAME_ID);
  if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) {
    iframe.contentWindow.postMessage(
      { source: 'pinagent-host', type: 'open-conversation', feedbackId },
      '*',
    );
  }
}

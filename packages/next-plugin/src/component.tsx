// SPDX-License-Identifier: Apache-2.0
'use client';

import { useEffect } from 'react';

export interface PinagentProps {
  /**
   * Mount the dock iframe alongside the widget script. Defaults to the
   * value of `NEXT_PUBLIC_PINAGENT_DOCK` (set by
   * `withPinagent(config, { dock: true })`), so the typical opt-in is
   * one keystroke in `next.config.ts` — no prop required here.
   *
   * Pass `dock={true}` explicitly to override at the component level.
   */
  dock?: boolean;
}

/**
 * Mount this in your root layout (typically `app/layout.tsx`) inside `<body>`.
 * It mounts the Pinagent widget script imperatively *after* hydration, so it
 * never participates in SSR and can't cause hydration mismatches with other
 * client-side script injectors (PostHog, GTM, Hotjar, etc.).
 *
 * Renders nothing in production builds.
 */
export function Pinagent({ dock }: PinagentProps = {}): null {
  const dockEnabled = dock ?? process.env.NEXT_PUBLIC_PINAGENT_DOCK === '1';

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof document === 'undefined') return;

    if (!document.getElementById('__pinagent-script')) {
      const s = document.createElement('script');
      s.id = '__pinagent-script';
      s.src = '/__pinagent/widget.js';
      s.defer = true;
      document.head.appendChild(s);
    }

    // Dock iframe — same shape as vite-plugin's transformIndexHtml
    // injection (see packages/vite-plugin/src/index.ts::DOCK_IFRAME_TAG).
    // Full-viewport, pointer-events:none, z-index just under the widget
    // FAB's 2147483647 so neither surface visually steals from the other.
    if (dockEnabled && !document.getElementById('__pinagent-dock')) {
      const iframe = document.createElement('iframe');
      iframe.id = '__pinagent-dock';
      iframe.src = '/__pinagent/dock/embedded.html';
      iframe.title = 'Pinagent dock';
      // Use cssText so we set all the positioning rules in one shot
      // without React-style camelCase concerns.
      iframe.style.cssText = [
        'position:fixed',
        'inset:0',
        'width:100vw',
        'height:100vh',
        'border:0',
        'background:transparent',
        'pointer-events:none',
        'z-index:2147483646',
        'color-scheme:light',
      ].join(';');
      document.body.appendChild(iframe);
    }

    // Host-side bridge for Cmd/Ctrl + Shift + P. The iframe's own
    // keydown listener only fires while focus is inside the dock; this
    // listener catches the shortcut from anywhere on the host page and
    // postMessages a toggle to the iframe. Mirror of vite-plugin's
    // inline DOCK_HOST_BRIDGE_TAG.
    if (!dockEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const iframe = document.getElementById('__pinagent-dock');
        if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ source: 'pinagent-host', type: 'toggle-dock' }, '*');
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dockEnabled]);

  return null;
}

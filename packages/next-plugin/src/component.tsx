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

    // Host-side bridge. Mirror of vite-plugin's inline
    // DOCK_HOST_BRIDGE_TAG — see that file for the contract.
    //
    //   - Cmd/Ctrl + Shift + P toggles the dock from anywhere on the
    //     page (the iframe's own keydown listener only fires while
    //     focus is inside the dock).
    //   - Pointer-events passthrough: the dock broadcasts its
    //     interactive rects via postMessage; we toggle the iframe's
    //     `pointer-events` on every mousemove so the FAB is reachable
    //     but the host page stays clickable everywhere the dock isn't.
    if (!dockEnabled) return;
    let rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const getIframe = (): HTMLIFrameElement | null => {
      const el = document.getElementById('__pinagent-dock');
      return el instanceof HTMLIFrameElement ? el : null;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const iframe = getIframe();
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ source: 'pinagent-host', type: 'toggle-dock' }, '*');
        }
      }
    };
    const toggle = (x: number, y: number) => {
      const iframe = getIframe();
      if (!iframe) return;
      let inside = false;
      for (const r of rects) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          inside = true;
          break;
        }
      }
      iframe.style.pointerEvents = inside ? 'auto' : 'none';
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as
        | { source?: string; type?: string; rects?: unknown; x?: number; y?: number }
        | null;
      if (!d || d.source !== 'pinagent-dock') return;
      if (d.type === 'layout') {
        rects = Array.isArray(d.rects) ? (d.rects as typeof rects) : [];
      } else if (d.type === 'pointer-move' && typeof d.x === 'number' && typeof d.y === 'number') {
        // Once the iframe is `pointer-events: auto`, the host doc no
        // longer sees mousemoves over the iframe's region. The dock
        // forwards them so we can toggle back to `none` when the
        // cursor sits over an empty area of the iframe.
        toggle(d.x, d.y);
      }
    };
    const onMove = (e: MouseEvent) => toggle(e.clientX, e.clientY);
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    document.addEventListener('mousemove', onMove, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('mousemove', onMove, true);
    };
  }, [dockEnabled]);

  return null;
}

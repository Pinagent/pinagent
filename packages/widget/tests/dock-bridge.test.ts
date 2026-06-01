// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDockHidden, toggleDock } from '../src/dock-bridge';

// The dock iframe is mounted as a sibling of the widget by the host bridge
// (see vite-plugin/index.ts). These helpers drive it from the host realm so
// shortcuts pressed inside the widget's own iframes (the composer) can still
// reach it — iframe keystrokes never bubble to the host document.

const DOCK_IFRAME_ID = '__pinagent-dock';

function mountDockIframe(): { iframe: HTMLIFrameElement; postMessage: ReturnType<typeof vi.fn> } {
  const iframe = document.createElement('iframe');
  iframe.id = DOCK_IFRAME_ID;
  document.body.appendChild(iframe);
  const postMessage = vi.fn();
  // happy-dom gives the iframe a contentWindow; stub postMessage on it.
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: { postMessage },
  });
  return { iframe, postMessage };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('toggleDock', () => {
  it('posts a host toggle-dock frame to the dock iframe', () => {
    const { postMessage } = mountDockIframe();
    toggleDock();
    expect(postMessage).toHaveBeenCalledWith({ source: 'pinagent-host', type: 'toggle-dock' }, '*');
  });

  it('is a no-op when no dock iframe is mounted', () => {
    expect(() => toggleDock()).not.toThrow();
  });
});

describe('setDockHidden', () => {
  it('hides and reveals the dock iframe element', () => {
    const { iframe } = mountDockIframe();
    expect(iframe.style.visibility).toBe('');

    setDockHidden(true);
    expect(iframe.style.visibility).toBe('hidden');

    setDockHidden(false);
    expect(iframe.style.visibility).toBe('');
  });

  it('is a no-op when no dock iframe is mounted', () => {
    expect(() => setDockHidden(true)).not.toThrow();
  });
});

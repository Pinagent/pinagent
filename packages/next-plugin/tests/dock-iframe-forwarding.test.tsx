// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Regression: the `<Pinagent dock />` component must forward an
 * allowlist (`fixtures`, `state`) of query params from the parent
 * URL into the dock iframe's `src`. Without forwarding, flags like
 * `?fixtures=on` and `?state=disconnected` silently no-op for every
 * embedded consumer — the iframe sees only its own static location
 * and the docked dashboard renders against the real backend (or
 * nothing) instead of the fixtures/state the developer requested.
 *
 * Mirrors `packages/vite-plugin/src/index.ts::DOCK_IFRAME_TAG`, which
 * does the same job via an inline script after `transformIndexHtml`.
 * The vite side is statically guarded in
 * `packages/vite-plugin/tests/dock-iframe-forwarding.test.ts`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pinagent } from '../src/component';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The component's useEffect bails when NODE_ENV !== 'development', so
// the iframe injection only runs in dev mode. Pin once for the whole
// file; vitest's default is 'test'.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
beforeAll(() => {
  process.env.NODE_ENV = 'development';
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // Clean up DOM artifacts the component appends to document.head/body
  // so tests don't see each other's iframes.
  document.getElementById('__pinagent-dock')?.remove();
  document.getElementById('__pinagent-script')?.remove();
  // Reset location for the next test. happy-dom permits direct
  // assignment to `window.location.href` and doesn't fire a real nav.
  window.history.replaceState(null, '', '/');
});

afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

function getDockIframe(): HTMLIFrameElement | null {
  return document.getElementById('__pinagent-dock') as HTMLIFrameElement | null;
}

describe('<Pinagent dock /> — dock iframe query forwarding', () => {
  it('forwards ?fixtures from the parent URL into the iframe src', () => {
    window.history.replaceState(null, '', '/some/page?fixtures=on');
    act(() => {
      root.render(<Pinagent dock />);
    });
    const iframe = getDockIframe();
    expect(iframe).not.toBeNull();
    expect(iframe?.src).toContain('/__pinagent/dock/embedded.html?fixtures=on');
  });

  it('forwards ?state from the parent URL into the iframe src', () => {
    window.history.replaceState(null, '', '/?state=disconnected');
    act(() => {
      root.render(<Pinagent dock />);
    });
    expect(getDockIframe()?.src).toContain('/__pinagent/dock/embedded.html?state=disconnected');
  });

  it('forwards both allowlisted params together', () => {
    window.history.replaceState(null, '', '/?fixtures=on&state=disconnected');
    act(() => {
      root.render(<Pinagent dock />);
    });
    const src = getDockIframe()?.src ?? '';
    expect(src).toContain('/__pinagent/dock/embedded.html?');
    expect(src).toContain('fixtures=on');
    expect(src).toContain('state=disconnected');
  });

  it('drops non-allowlisted query params (allowlist, not passthrough)', () => {
    // `utm_*` and friends must NOT leak into the iframe — the dock
    // would happily render them but they're noise at best and a
    // tracking concern at worst.
    window.history.replaceState(null, '', '/?fixtures=on&utm_campaign=spy&token=secret');
    act(() => {
      root.render(<Pinagent dock />);
    });
    const src = getDockIframe()?.src ?? '';
    expect(src).toContain('fixtures=on');
    expect(src).not.toContain('utm_campaign');
    expect(src).not.toContain('token=');
  });

  it('omits the query string entirely when no allowed params are present', () => {
    window.history.replaceState(null, '', '/?utm_source=x');
    act(() => {
      root.render(<Pinagent dock />);
    });
    const iframe = getDockIframe();
    expect(iframe).not.toBeNull();
    // No `?` at all — not `?` with an empty query.
    expect(iframe?.src.endsWith('/__pinagent/dock/embedded.html')).toBe(true);
  });

  it('does not mount the iframe when dock is disabled', () => {
    window.history.replaceState(null, '', '/?fixtures=on');
    act(() => {
      root.render(<Pinagent />);
    });
    expect(getDockIframe()).toBeNull();
  });
});

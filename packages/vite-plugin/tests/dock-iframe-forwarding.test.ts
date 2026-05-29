// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Regression: vite-plugin's `transformIndexHtml` injects an inline
 * script (`DOCK_IFRAME_TAG` in src/index.ts) that builds the dock
 * iframe and forwards an allowlist (`fixtures`, `state`) of query
 * params from the parent URL into the iframe `src`.
 *
 * The inline script can't be imported, so we read the source file,
 * extract the script body, and run it in happy-dom against a mocked
 * `window.location.search`. That exercises the actual bytes that
 * ship to the browser — a regression in the allowlist (or the
 * iframe id / src path) fails here.
 *
 * Mirror of `packages/next-plugin/tests/dock-iframe-forwarding.test.tsx`,
 * which exercises the React-component equivalent.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// happy-dom rewrites `import.meta.url` to a non-file scheme, so we
// can't `fileURLToPath` it here. Vitest runs with cwd = repo root,
// and the workspace layout pins this path — read directly.
const INDEX_PATH = resolve(process.cwd(), 'packages/vite-plugin/src/index.ts');

let dockIframeScriptBody: string;

beforeAll(async () => {
  const src = await readFile(INDEX_PATH, 'utf8');
  // Pull the body out of the exported `DOCK_IFRAME_SCRIPT` — a chain of
  // string concatenations between `'(function(){'` and the closing
  // `'})();'`. The literal is short and stable; if someone rewrites the
  // constant we want a loud failure here, not a silent pass against a
  // stale extraction.
  const match = src.match(
    /const DOCK_IFRAME_SCRIPT[\s\S]*?'\(function\(\)\{'\s*\+([\s\S]*?)'\}\)\(\);';/,
  );
  if (!match) {
    throw new Error(
      'failed to extract DOCK_IFRAME_SCRIPT body from vite-plugin/src/index.ts — ' +
        'the constant was likely renamed or refactored; update this test.',
    );
  }
  // Concatenate the string literals: drop the surrounding quotes and
  // the `+` separators. Each chunk is `'…'` on its own line.
  const chunks = match[1]?.match(/'([^']*)'/g) ?? [];
  dockIframeScriptBody = chunks
    .map((c) => c.slice(1, -1))
    // Tag bookends were stripped above; just join.
    .join('');
});

afterEach(() => {
  document.getElementById('__pinagent-dock')?.remove();
  window.history.replaceState(null, '', '/');
});

function runDockScript(): void {
  // The script body is the IIFE *interior* — wrap and eval. Using
  // `new Function` avoids `eval` lint noise and gives a clean scope.
  new Function(dockIframeScriptBody)();
}

function getIframe(): HTMLIFrameElement | null {
  return document.getElementById('__pinagent-dock') as HTMLIFrameElement | null;
}

describe('vite-plugin DOCK_IFRAME_TAG — dock iframe query forwarding', () => {
  it('forwards ?fixtures from the parent URL into the iframe src', () => {
    window.history.replaceState(null, '', '/some/page?fixtures=on');
    runDockScript();
    expect(getIframe()?.src).toContain('/__pinagent/dock/embedded.html?fixtures=on');
  });

  it('forwards ?state from the parent URL into the iframe src', () => {
    window.history.replaceState(null, '', '/?state=disconnected');
    runDockScript();
    expect(getIframe()?.src).toContain('/__pinagent/dock/embedded.html?state=disconnected');
  });

  it('forwards both allowlisted params together', () => {
    window.history.replaceState(null, '', '/?fixtures=on&state=disconnected');
    runDockScript();
    const src = getIframe()?.src ?? '';
    expect(src).toContain('fixtures=on');
    expect(src).toContain('state=disconnected');
  });

  it('drops non-allowlisted query params (allowlist, not passthrough)', () => {
    window.history.replaceState(null, '', '/?fixtures=on&utm_campaign=spy&token=secret');
    runDockScript();
    const src = getIframe()?.src ?? '';
    expect(src).toContain('fixtures=on');
    expect(src).not.toContain('utm_campaign');
    expect(src).not.toContain('token=');
  });

  it('omits the query string entirely when no allowed params are present', () => {
    window.history.replaceState(null, '', '/?utm_source=x');
    runDockScript();
    expect(getIframe()?.src.endsWith('/__pinagent/dock/embedded.html')).toBe(true);
  });

  it('sets the iframe id and title the host bridge expects', () => {
    // The host bridge (DOCK_HOST_BRIDGE_TAG) looks up the iframe by id
    // `__pinagent-dock` to toggle pointer-events and post toggle-dock
    // messages. A rename here would silently break Cmd/Ctrl+Shift+P
    // and the click-through behavior.
    window.history.replaceState(null, '', '/');
    runDockScript();
    const el = getIframe();
    expect(el?.id).toBe('__pinagent-dock');
    expect(el?.title).toBe('Pinagent dock');
  });
});

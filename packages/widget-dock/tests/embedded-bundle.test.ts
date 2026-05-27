// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Loads the built `dist/embedded.html` + the JS chunks it points to and
 * asserts that module init runs to completion. The regression this
 * guards against was a circular import (router.tsx → DockShell →
 * NavRail → router.tsx) which left `ROUTE_PATHS` undefined when
 * NavRail's top-level `ROUTES` const evaluated in the bundled
 * output. Result: `Cannot read properties of undefined (reading
 * 'overview')` at module init, the `data-pinagent-embedded='true'`
 * line never ran, and the iframe painted an opaque cream rectangle
 * over the entire host page.
 *
 * The bug only manifests in the BUNDLED build (where rollup hoists
 * modules into a single chunk and the cycle's variable-init order
 * matters). Source-level imports happen to work because of TS / vite
 * dev-mode module isolation. So a `import { App } from '../src/...'`
 * test would silently pass.
 *
 * If this test fails with ENOENT, run
 * `pnpm --filter @pinagent/widget-dock build` first.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

function distAvailable(): boolean {
  return existsSync(join(DIST, 'embedded.html')) && existsSync(join(DIST, 'assets'));
}

function entryScriptSrc(): string {
  const html = readFileSync(join(DIST, 'embedded.html'), 'utf8');
  // <script type="module" crossorigin src="/__pinagent/dock/assets/embedded-XXXX.js">
  const match = /<script[^>]+src="([^"]+\/assets\/embedded-[^"]+\.js)"/.exec(html);
  if (!match) throw new Error('could not find embedded entry script in dist/embedded.html');
  return match[1] as string;
}

function localPathForAsset(src: string): string {
  // Bundle hrefs look like `/__pinagent/dock/assets/embedded-XXX.js`. The
  // file lives at `<dist>/assets/embedded-XXX.js`.
  const file = src.slice(src.lastIndexOf('/assets/') + '/assets/'.length);
  return join(DIST, 'assets', file);
}

beforeEach(() => {
  // The embedded entry calls `document.getElementById('root')` at
  // module init and throws `missing #root` if it isn't there. Set up
  // the DOM the same way `dist/embedded.html` does so init can complete.
  document.documentElement.innerHTML = '<head></head><body><div id="root"></div></body>';
  // Just-in-case sanity wipe — happy-dom carries state across tests
  // unless we reset.
  delete (document.documentElement as HTMLElement & { dataset: DOMStringMap }).dataset
    .pinagentEmbedded;
});

describe('built embedded bundle', () => {
  it.skipIf(!distAvailable())(
    'evaluates its top-level body without throwing and sets data-pinagent-embedded on <html>',
    async () => {
      const scriptHref = entryScriptSrc();
      const localPath = localPathForAsset(scriptHref);
      expect(existsSync(localPath)).toBe(true);

      // Dynamic-import the built chunk. The relative `import "./globals-XYZ.js"`
      // resolves against this file URL → reaches the sibling chunk in
      // `<dist>/assets/`. The bundle inlines React / TanStack Router etc.,
      // so we don't need to provide any external module resolution.
      const moduleUrl = pathToFileURL(localPath).href;
      await expect(import(moduleUrl)).resolves.toBeDefined();

      // The very first non-import line of `entry/embedded.tsx` is
      //   document.documentElement.dataset.pinagentEmbedded = 'true';
      // If anything above it threw at module init (the circular-import
      // bug), this assertion fails — which is exactly the symptom we
      // saw in the browser when the regression shipped.
      expect(document.documentElement.dataset.pinagentEmbedded).toBe('true');
    },
  );

  it('the dist actually contains an embedded entry chunk (build artefact sanity check)', () => {
    if (!distAvailable()) {
      throw new Error(
        `dist/ missing — run \`pnpm --filter @pinagent/widget-dock build\` then re-run tests.`,
      );
    }
    const assets = readdirSync(join(DIST, 'assets'));
    expect(assets.some((f) => /^embedded-.*\.js$/.test(f))).toBe(true);
    expect(assets.some((f) => /^globals-.*\.js$/.test(f))).toBe(true);
  });
});

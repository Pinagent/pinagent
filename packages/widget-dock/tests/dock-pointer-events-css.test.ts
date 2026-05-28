// SPDX-License-Identifier: Apache-2.0
/**
 * Regression pin for the embedded-dock click-through bug (PR #94).
 *
 * The dock's embedded body needs `pointer-events: none` so unrelated
 * clicks fall through the transparent iframe areas to the host page.
 * A sibling rule restores `pointer-events: auto` on the dock chrome
 * so it stays interactive.
 *
 * The original selector was `body *` (universal descendant) — it
 * applied `auto` explicitly to every node, silently overriding the
 * `pointer-events-none` wrapper trick in `ListRow.tsx` (overlay
 * `<button>` at z-0, content at z-10 with `pointer-events-none` so
 * clicks fall through to the button below). Result: clicks on the
 * title text or status dot were captured by the text span, and only
 * clicks on the row's empty padding navigated.
 *
 * The fix restricts the restore to `body > *` (direct children of
 * body only). `pointer-events` is inherited, so descendants pick up
 * `auto` from the React mount root unless they explicitly set `none`
 * themselves.
 *
 * This test pins the source CSS rather than runtime behavior because
 * `pointer-events: none` only affects real user clicks (hit testing)
 * — synthetic `.click()` / `dispatchEvent` calls bypass it, so a
 * JSDOM/happy-dom click test wouldn't catch the regression.
 * If you find yourself wanting to relax this assertion, please don't
 * — re-introduce the bug in a single character.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOBALS_CSS = resolve(__dirname, '..', 'src', 'styles', 'globals.css');

describe('embedded dock pointer-events CSS', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8');

  it('restores pointer-events on the direct children of body, not every descendant', () => {
    expect(css).toMatch(
      /html\[data-pinagent-embedded="true"\]\s+body\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto/,
    );
  });

  it('does not blanket-restore pointer-events on every descendant', () => {
    // Match a `body *` (with whitespace between body and *, but no `>`)
    // declaration block that sets pointer-events. This is the original
    // bug pattern — flagging it explicitly so a revert can't sneak by.
    expect(css).not.toMatch(
      /html\[data-pinagent-embedded="true"\]\s+body\s+\*\s*\{[^}]*pointer-events:\s*auto/,
    );
  });

  it('still turns off pointer-events on the body itself for click-through', () => {
    // The whole click-through mechanism depends on body having
    // `pointer-events: none`. If that line goes missing, the iframe
    // captures every host-page click and the host UI is unreachable.
    expect(css).toMatch(
      /html\[data-pinagent-embedded="true"\]\s+body\s*\{[^}]*pointer-events:\s*none/,
    );
  });
});

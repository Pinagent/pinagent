// SPDX-License-Identifier: Apache-2.0
import type { DbBackend } from './db/client';

/**
 * Surfacing the browser cache's `:memory:` degradation (ticket 005).
 *
 * The SQLite worker prefers the persistent OPFS SAH Pool VFS and silently
 * falls back to `:memory:` when SAH can't install — the common trigger being
 * a *second tab* of the same app, since only one worker can hold the SAH
 * handles. In that tab the cache works but is lost on reload. The only signal
 * was a console line; this module turns the worker-reported backend into a
 * quiet, one-time, dismissible UI hint.
 *
 * Pure helpers (no DOM) so the decision logic is unit-testable; the DOM
 * wiring lives in composer-iframe.ts / fab-tray.ts.
 */

/**
 * localStorage key recording that the developer dismissed the composer-footer
 * storage note. Per-origin (the widget is localhost-only), set once — the note
 * is informational, so once acknowledged it shouldn't nag on every reload.
 */
export const STORAGE_NOTE_DISMISS_KEY = 'pinagent:storage-note-dismissed';

/** Best-effort read; private windows / disabled storage degrade to "not dismissed". */
function isNoteDismissed(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(STORAGE_NOTE_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether to show the one-time composer-footer storage note: only when the
 * worker landed on `:memory:` AND the developer hasn't dismissed it before.
 * `'opfs'` (the persistent, healthy case — including the optimistic default
 * before init resolves) never shows it.
 */
export function shouldShowStorageNote(
  backend: DbBackend,
  storage: Pick<Storage, 'getItem'>,
): boolean {
  return backend === 'memory' && !isNoteDismissed(storage);
}

/** Persist the dismissal so the note doesn't return on the next reload. */
export function dismissStorageNote(storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(STORAGE_NOTE_DISMISS_KEY, '1');
  } catch {
    // Storage unavailable (private window) — the note simply re-appears next
    // reload, which is acceptable for a non-blocking informational hint.
  }
}

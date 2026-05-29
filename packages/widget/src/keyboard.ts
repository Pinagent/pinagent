// SPDX-License-Identifier: Apache-2.0

export function shouldIgnoreHotkey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as (Element & { isContentEditable?: boolean }) | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

/**
 * Hotkey for "hop to next in-flight agent." Shift+N. Picked
 * deliberately: `n` alone is too easy to hit while typing, and the
 * obvious chord candidates (Cmd+N / Ctrl+N) are owned by the browser
 * for opening new windows.
 */
export function isHopKey(e: KeyboardEvent): boolean {
  return e.key === 'N' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Pick the next composer to expand from a list of currently-active
 * (running or pending) composers, given the currently-expanded one.
 * Pure: no DOM, no side effects — the caller does the swap.
 *
 * Returns null in the no-op cases:
 *  - empty list (nothing to hop to)
 *  - single item AND it's already expanded
 *
 * Otherwise rotates insertion-order with wrap-around; the current is
 * 0-relative so the first hop from "nothing expanded" lands on
 * active[0].
 */
export function pickNextActive<T>(active: readonly T[], current: T | null): T | null {
  if (active.length === 0) return null;
  if (active.length === 1) return active[0] === current ? null : (active[0] ?? null);
  const idx = current ? active.indexOf(current) : -1;
  return active[(idx + 1) % active.length] ?? null;
}

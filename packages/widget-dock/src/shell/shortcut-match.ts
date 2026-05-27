// SPDX-License-Identifier: Apache-2.0
/**
 * Pure matching logic for the dock's keyboard shortcuts. Lives in its
 * own file so tests can import it without dragging the React tree +
 * router + UI components into Vite's transform pipeline.
 *
 * The hook in `useKeyboardShortcuts.ts` dispatches the actions this
 * module returns.
 */

/** Window between `g` and the second key (Conversations / History / Settings). */
export const G_CHORD_TIMEOUT_MS = 1500;

export type ShortcutAction =
  /** Cmd/Ctrl + Shift + P — toggle the dock open/closed. */
  | { type: 'toggle' }
  /** g c / g h / g s — go to a top-level route. */
  | { type: 'navigate'; to: '/conversations' | '/history' | '/settings' }
  /** / — focus the active route's search input. */
  | { type: 'focus-search' }
  /** Initial `g` press — start the chord window. */
  | { type: 'start-g-chord' }
  /** Second key after `g` didn't match — drop the chord. */
  | { type: 'cancel-g-chord' }
  /** Key was irrelevant (no modifier match, in a text field, etc.). */
  | { type: 'none' };

export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

export interface ShortcutMatchInput {
  /** True if the previous keypress was `g` and the chord window is open. */
  pendingG: boolean;
  /** True when the dock surface is open — gates `/` (no input to focus when closed). */
  isOpen: boolean;
}

export function matchKeyboardShortcut(
  e: ShortcutKeyEvent,
  state: ShortcutMatchInput,
): ShortcutAction {
  // Cmd/Ctrl + Shift + P always wins — even while typing. Standard
  // command-palette muscle memory; users expect it to interrupt.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
    return { type: 'toggle' };
  }

  // For everything else, defer to the focused field — typing 'g'
  // in a comment input shouldn't navigate.
  if (isTypingTarget(e.target)) return { type: 'none' };

  // Don't trap modifier combos other than the explicit one above.
  // Cmd+R, Cmd+T, etc. all reach the browser.
  if (e.metaKey || e.ctrlKey || e.altKey) return { type: 'none' };

  // Inside the g-chord window, look for the second key.
  if (state.pendingG) {
    if (e.key === 'c') return { type: 'navigate', to: '/conversations' };
    if (e.key === 'h') return { type: 'navigate', to: '/history' };
    if (e.key === 's') return { type: 'navigate', to: '/settings' };
    // Any other key cancels — including a second `g`.
    return { type: 'cancel-g-chord' };
  }

  if (e.key === 'g') return { type: 'start-g-chord' };

  // `/` focuses the active route's search input. Only meaningful when
  // the dock is open and a search input is mounted (the caller decides
  // whether the input actually exists).
  if (e.key === '/' && state.isOpen) return { type: 'focus-search' };

  return { type: 'none' };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

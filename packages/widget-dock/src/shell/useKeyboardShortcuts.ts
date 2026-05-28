// SPDX-License-Identifier: Apache-2.0
/**
 * Global keyboard shortcuts for the dock.
 *
 *   - Cmd/Ctrl + Shift + P  — toggle the dock open/close. Works from
 *                              anywhere on the page: the host script
 *                              listens too and postMessages a
 *                              `{ source: 'pinagent-host', type:
 *                              'toggle-dock' }` frame to the iframe.
 *   - g c / g h / g s       — go to Conversations / History / Settings.
 *                              Two-key chord, 1.5s window for the second
 *                              key, cancels on any other key.
 *   - /                     — focus the first `input[type="search"]` in
 *                              the current view (no-op if there isn't
 *                              one). The route components mark their
 *                              search inputs with `type="search"` for
 *                              this hook and for assistive tech.
 *   - c (widget pick hotkey) — only while embedded in a host iframe:
 *                              forward to the host so the widget opens
 *                              its element picker. The host's keydown
 *                              listeners (including the widget's own) only
 *                              fire while focus is on the host page, so a
 *                              `c` typed inside the focused dock would
 *                              otherwise do nothing. Mirror of the
 *                              `toggle-dock` bridge, in the other
 *                              direction. See vite-plugin/index.ts.
 *
 * Esc-to-close lives in `useDockMode` (panel mode only) and is
 * intentionally untouched here — different concern.
 *
 * Matching logic lives in `shortcut-match.ts` (pure, no React) so it
 * can be unit-tested without the React tree.
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ROUTE_PATHS } from '../route-paths';
import { G_CHORD_TIMEOUT_MS, matchKeyboardShortcut, type ShortcutAction } from './shortcut-match';

/**
 * The widget's default pick hotkey — mirrors `resolveHotkey()` in
 * `@pinagent/widget`. The host's custom-hotkey override
 * (`window.__pinagentHotkey`) isn't forwarded into the dock iframe, so
 * the dock assumes the default. A custom hotkey still works from the host
 * page itself; only the from-inside-the-dock path falls back to `c`.
 */
const DEFAULT_PICKER_HOTKEY = 'c';

export interface KeyboardShortcutOptions {
  /** Called when Cmd+Shift+P fires (or host-side bridge posts it). */
  onToggle: () => void;
  /**
   * Open the dock if it's closed when a shortcut fires that needs
   * visible UI (the `g` chord, `/`). Without this the keystroke
   * navigates but the user can't see the result.
   */
  open: () => void;
  /**
   * True when the dock surface is open. Determines whether `g`
   * chord / `/` shortcuts try to focus content (when open) vs. just
   * open the dock to where they navigated (when closed).
   */
  isOpen: boolean;
  /**
   * True when the dock runs inside the host-injected iframe. Gates the
   * `c` pick-hotkey forwarding: only an embedded dock needs to relay it
   * to the host. In the standalone dev preview the widget shares the
   * document and catches `c` itself, so forwarding would double-toggle.
   */
  embedded: boolean;
}

export function useKeyboardShortcuts({
  onToggle,
  open,
  isOpen,
  embedded,
}: KeyboardShortcutOptions): void {
  const navigate = useNavigate();

  useEffect(() => {
    let chordTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingG = false;
    const cancelChord = () => {
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
      pendingG = false;
    };

    const dispatch = (e: KeyboardEvent, action: ShortcutAction) => {
      switch (action.type) {
        case 'toggle':
          e.preventDefault();
          cancelChord();
          onToggle();
          return;
        case 'navigate':
          e.preventDefault();
          cancelChord();
          if (!isOpen) open();
          if (action.to === '/conversations') {
            void navigate({ to: ROUTE_PATHS.conversations });
          } else if (action.to === '/history') {
            void navigate({ to: ROUTE_PATHS.history });
          } else {
            void navigate({ to: ROUTE_PATHS.settings });
          }
          return;
        case 'focus-search': {
          const input = document.querySelector<HTMLInputElement>('input[type="search"]');
          if (input) {
            e.preventDefault();
            input.focus();
            input.select();
          }
          return;
        }
        case 'enter-picker':
          // Relay to the host page; the widget IIFE (mounted there)
          // listens for this and opens its element picker. Only reached
          // when embedded, so `window.parent` is the host window.
          e.preventDefault();
          cancelChord();
          window.parent.postMessage({ source: 'pinagent-dock', type: 'enter-picker' }, '*');
          return;
        case 'start-g-chord':
          pendingG = true;
          if (chordTimer) clearTimeout(chordTimer);
          chordTimer = setTimeout(cancelChord, G_CHORD_TIMEOUT_MS);
          return;
        case 'cancel-g-chord':
          cancelChord();
          return;
        case 'none':
          return;
      }
    };

    const pickerHotkey = embedded ? DEFAULT_PICKER_HOTKEY : null;
    const onKey = (e: KeyboardEvent) => {
      dispatch(e, matchKeyboardShortcut(e, { pendingG, isOpen, pickerHotkey }));
    };

    // Host-side bridge: the host page's keydown listener posts a
    // `toggle-dock` message so Cmd+Shift+P works from outside the
    // iframe. See vite-plugin/index.ts and next-plugin/component.tsx
    // for the host-side script.
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'pinagent-host') return;
      if (data.type === 'toggle-dock') onToggle();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      cancelChord();
    };
  }, [navigate, onToggle, open, isOpen, embedded]);
}
